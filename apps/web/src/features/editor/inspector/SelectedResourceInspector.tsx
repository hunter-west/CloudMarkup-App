import { ServiceConfigurationNavigation } from "./ServiceConfigurationNavigation.js";
import { defaultPurposeOperationId } from "../model/workload-operation-command.js";
import { ResourceRepairControl } from "./ResourceRepairControl.js";
import {
  Button,
  Disclosure,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from "@cloudmarkup/ui";
import type { ArchitectureEdge } from "@cloudmarkup/domain";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Box,
  FileCode2,
  Info,
  Link2,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { PreparedServiceRemoval } from "../model/remove-service-command.js";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";

import { useModePreference } from "../../../preferences/index.js";
import type { InspectorTab } from "../../../shell/AppShell.js";
import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import { CatalogServiceIcon } from "../../../provider-icons/CatalogServiceIcon.js";
import {
  EDITOR_CONNECTION_CATEGORY_ORDER,
  createConfigurationFormBufferKey,
  editorConnectionCategoryLabel,
  prepareWorkloadOperationCommand,
  projectArchitectureOwnedConfigurationSummaries,
  resolveWorkloadOperationDraft,
  suggestEditorNodePlacementAbsolutePosition,
  WorkloadOperationPreparationError,
  type EditorConnectionCategory,
  type PreparedWorkloadOperationCommand,
  type WorkloadOperationDraft,
} from "../model/index.js";
import {
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/index.js";
import {
  convertConfigurationFormValues,
  createConfigurationFormModel,
  fieldErrorMessage,
  type MutableConfigurationFormValues,
  type ConfigurationFormFieldModel,
} from "./configuration-form-model.js";
import { OwnedConfigurationPanel } from "./OwnedConfigurationPanel.js";
import {
  AdvancedConfigurationFields,
  ConfigurationInput,
} from "./ConfigurationFields.js";
import {
  resolveSelectedResourceInspectorModel,
  type SelectedEdgeInspectorModel,
  type SelectedNodeInspectorModel,
  type SelectedResourceInspectorModel,
  type SelectedResourceInspectorResolution,
} from "./selected-resource-model.js";

const inspectorTabs = [
  ["configure", "Configure"],
  ["connect", "Connect"],
  ["learn", "Learn"],
] as const;

type SelectedResourceInspectorTab = Exclude<InspectorTab, "architecture">;

function InspectorLearnButton({ label }: { readonly label: string }) {
  const shell = useWorkspaceShellController();
  return (
    <Button
      size="compact"
      variant="quiet"
      aria-label={label}
      onClick={() => {
        shell?.openContextPanel("inspector-panel", "learn");
      }}
    >
      <Info aria-hidden="true" size={16} />
    </Button>
  );
}

function useReadyEditorDocumentSession() {
  const session = useEditorDocumentSession();
  if (session.status !== "ready") {
    throw new Error(
      "The selected-resource inspector requires a valid Architecture Document.",
    );
  }
  return session;
}

function SelectedIcon({
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
}) {
  const session = useEditorDocumentSession();
  if (model.kind === "edge") {
    return (
      <span
        aria-hidden="true"
        className="selected-inspector__relationship-icon"
      >
        <Link2 size={20} />
      </span>
    );
  }

  if (model.service.iconId === null) {
    return (
      <span
        aria-hidden="true"
        className="selected-inspector__relationship-icon"
      >
        <Box size={20} />
      </span>
    );
  }

  return (
    <CatalogServiceIcon
      className="selected-inspector__resource-icon"
      iconId={model.service.iconId}
      registry={session.iconRegistry}
      serviceName={model.service.displayName}
    />
  );
}

function placementOptionValue(parentNodeId: string | null): string {
  return parentNodeId === null ? "root:" : `node:${parentNodeId}`;
}

function NodePlacementControl({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const inputId = useId();
  const options = useMemo(
    () => session.listPlacementOptions(model.node.id),
    [model.node.id, session],
  );
  const currentParentNodeId = model.node.semantic.parent?.nodeId ?? null;
  const currentOption = options.find(
    (option) => option.parentNodeId === currentParentNodeId,
  );
  const currentValue =
    currentOption === undefined
      ? ""
      : placementOptionValue(currentOption.parentNodeId);
  const [draft, setDraft] = useState<{
    readonly baselineValue: string;
    readonly error?: string;
    readonly nodeId: string;
    readonly selectedValue: string;
  } | null>(null);
  const activeDraft =
    draft?.nodeId === model.node.id && draft.baselineValue === currentValue
      ? draft
      : null;
  const selectedValue = activeDraft?.selectedValue ?? currentValue;
  const placementError = activeDraft?.error;

  const selectedOption = options.find(
    (option) => placementOptionValue(option.parentNodeId) === selectedValue,
  );
  const hasChanged =
    selectedOption !== undefined &&
    selectedOption.parentNodeId !== currentParentNodeId;

  function applyPlacement() {
    if (selectedOption === undefined) {
      setDraft({
        baselineValue: currentValue,
        error: "Choose a valid boundary placement before applying.",
        nodeId: model.node.id,
        selectedValue,
      });
      return;
    }

    let absolutePosition;
    try {
      absolutePosition = suggestEditorNodePlacementAbsolutePosition({
        catalog: session.catalog,
        document: session.document,
        nodeId: model.node.id,
        targetParentNodeId: selectedOption.parentNodeId,
      });
    } catch (error) {
      setDraft({
        baselineValue: currentValue,
        error:
          error instanceof Error ? error.message : "Placement is unavailable.",
        nodeId: model.node.id,
        selectedValue,
      });
      return;
    }
    const result = session.placeNode(
      model.node.id,
      selectedOption.parentNodeId,
      absolutePosition,
    );
    if (!result.ok) {
      setDraft({
        baselineValue: currentValue,
        error: result.message,
        nodeId: model.node.id,
        selectedValue,
      });
      return;
    }
    setDraft(null);
  }

  return (
    <section
      aria-label="Boundary placement"
      className="selected-inspector__section"
      id="selected-boundary-placement"
      tabIndex={-1}
    >
      <div className="selected-inspector__section-heading">
        <div>
          <p className="status-label">Boundary placement</p>
          <h4>Choose where this resource belongs</h4>
        </div>
        <InspectorLearnButton label="More information about boundary placement" />
      </div>
      {options.length === 0 ? (
        <p role="status">
          No valid boundary placement is available for this resource.
        </p>
      ) : (
        <>
          <FormField
            description="Only catalog-valid destinations are listed."
            error={
              placementError === undefined ? undefined : (
                <span role="alert">{placementError}</span>
              )
            }
            htmlFor={inputId}
            label="Place this resource"
          >
            <Select
              id={inputId}
              onChange={(event) => {
                setDraft({
                  baselineValue: currentValue,
                  nodeId: model.node.id,
                  selectedValue: event.target.value,
                });
              }}
              value={selectedValue}
            >
              {currentOption === undefined ? (
                <option disabled value="">
                  Current placement is unavailable
                </option>
              ) : null}
              {options.map((option) => (
                <option
                  key={placementOptionValue(option.parentNodeId)}
                  value={placementOptionValue(option.parentNodeId)}
                >
                  {option.label} · {option.technicalLabel}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="selected-inspector__actions">
            <Button
              disabled={!hasChanged}
              onClick={applyPlacement}
              type="button"
              variant="primary"
            >
              Apply placement
            </Button>
          </div>
          {session.catalog.parentEdges === "catalog" &&
          model.node.semantic.parent !== undefined ? (
            <ResourceRepairControl
              key={model.node.id}
              nodeId={model.node.id}
              kind="parent-connection"
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function ServiceRemovalControl({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const [preview, setPreview] = useState<PreparedServiceRemoval | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="selected-inspector__removal">
      <Button
        onClick={() => {
          const result = session.previewServiceRemoval(model.node.id);
          if (result.ok) {
            setError("");
            setPreview(result.preview);
          } else {
            setError(result.message);
          }
        }}
        size="compact"
        variant="secondary"
      >
        Delete service
      </Button>
      {preview === null && error !== "" ? <p role="alert">{error}</p> : null}
      {preview === null ? null : (
        <Dialog
          description="Review what will be removed from this draft before confirming."
          onClose={() => {
            setPreview(null);
          }}
          open
          title={"Delete " + model.title + "?"}
        >
          <p>
            This removes {model.title} and {String(preview.connectionCount)}{" "}
            connected relationship{preview.connectionCount === 1 ? "" : "s"}.
            {preview.releasedResourceCount > 0
              ? " It also releases " +
                String(preview.releasedResourceCount) +
                " generated supporting resource" +
                (preview.releasedResourceCount === 1 ? "" : "s") +
                "."
              : ""}
          </p>
          <p>
            Saved revisions stay available. Save a new revision to include this
            deletion in future exports. Undo is available after deletion.
          </p>
          {error === "" ? null : <p role="alert">{error}</p>}
          <div className="selected-inspector__actions">
            <Button
              onClick={() => {
                setPreview(null);
              }}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const result = session.removeService(preview);
                if (result.ok) setPreview(null);
                else setError(result.message);
              }}
              variant="danger"
            >
              Delete service
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function SelectedOverview({
  showTechnicalIdentity,
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
  readonly showTechnicalIdentity: boolean;
}) {
  const store = useEditorSessionStoreApi();
  const [copyStatus, setCopyStatus] = useState("");

  async function copyStableIdentifier() {
    try {
      await navigator.clipboard.writeText(model.target.id);
      const message = `Stable identifier ${model.target.id} copied.`;
      setCopyStatus(message);
      store.getState().announce(message);
    } catch {
      const message = `Clipboard access is unavailable for ${model.target.id}. Select its visible identifier to copy it.`;
      setCopyStatus(message);
      store.getState().announce(message);
    }
  }

  return (
    <section
      aria-label="Selected architecture element"
      className="selected-inspector__overview"
    >
      <Disclosure
        className="selected-inspector__overview-disclosure"
        summary={
          <span className="selected-inspector__identity">
            <span className="visually-hidden">
              Selected architecture element details:{" "}
            </span>
            <SelectedIcon model={model} />
            <span className="selected-inspector__identity-copy">
              <span className="status-label">
                {model.kind === "node"
                  ? model.service.displayName
                  : "Typed relationship"}
              </span>
              <span className="visually-hidden">. </span>
              <span className="selected-inspector__identity-title">
                {model.title}
              </span>
            </span>
          </span>
        }
      >
        <div className="selected-inspector__overview-details">
          <div className="selected-inspector__badges">
            <StatusBadge
              label={model.kind === "node" ? "Resource" : "Relationship"}
              tone="neutral"
            />
            <StatusBadge
              label={`${model.lifecycle.ownership} ownership`}
              tone={
                model.lifecycle.ownership === "generated"
                  ? "generated"
                  : model.lifecycle.ownership === "adopted"
                    ? "read-only"
                    : "neutral"
              }
            />
          </div>
          {model.kind === "edge" ? (
            <h4>{model.edge.semantic.relationshipType}</h4>
          ) : (
            <>
              {showTechnicalIdentity ? (
                <p className="architecture-node__technical">
                  <span>
                    {model.node.presentation.position.x},{" "}
                    {model.node.presentation.position.y}
                  </span>
                </p>
              ) : null}
              <NodePlacementControl model={model} />
            </>
          )}
          {showTechnicalIdentity ? (
            <Disclosure summary="Technical identity">
              <dl className="editor-inspector-list selected-inspector__technical">
                <div>
                  <dt>Stable ID</dt>
                  <dd>{model.target.id}</dd>
                </div>
                <div>
                  <dt>Configuration schema</dt>
                  <dd>
                    {model.configuration.schemaId} @{" "}
                    {model.configuration.schemaVersion}
                  </dd>
                </div>
                {model.kind === "node" ? (
                  <>
                    <div>
                      <dt>Service type</dt>
                      <dd>{model.node.semantic.serviceType}</dd>
                    </div>
                    <div>
                      <dt>Deployment key</dt>
                      <dd>{model.node.semantic.deploymentKey}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>Relationship type</dt>
                    <dd>{model.edge.semantic.relationshipType}</dd>
                  </div>
                )}
              </dl>
              <div className="selected-inspector__actions">
                <Button
                  onClick={() => {
                    void copyStableIdentifier();
                  }}
                  size="compact"
                  type="button"
                  variant="quiet"
                >
                  Copy stable identifier
                </Button>
              </div>
              {copyStatus === "" ? null : <p role="status">{copyStatus}</p>}
            </Disclosure>
          ) : null}
        </div>
      </Disclosure>
    </section>
  );
}
function ErrorSummary({
  advancedDisclosureId,
  errors,
  fields,
  summaryId,
}: {
  readonly advancedDisclosureId: string;
  readonly errors: FieldErrors<MutableConfigurationFormValues>;
  readonly fields: readonly ConfigurationFormFieldModel[];
  readonly summaryId: string;
}) {
  const items = fields.flatMap((field) => {
    const message = fieldErrorMessage(errors, field.field.property);
    return message === undefined ? [] : [{ field, message }];
  });
  const globalMessage =
    typeof errors.root?.["catalog"]?.message === "string"
      ? errors.root["catalog"].message
      : undefined;
  const count = items.length + (globalMessage === undefined ? 0 : 1);
  if (count === 0) {
    return null;
  }

  return (
    <div
      aria-labelledby="configuration-error-summary-title"
      className="selected-inspector__error-summary"
      id={summaryId}
      role="alert"
      tabIndex={-1}
    >
      <h4 id="configuration-error-summary-title">
        Review {String(count)} configuration {count === 1 ? "error" : "errors"}
      </h4>
      <ul>
        {globalMessage === undefined ? null : <li>{globalMessage}</li>}
        {items.map(({ field, message }) => (
          <li key={field.field.property}>
            <a
              href={`#${field.inputId}`}
              onClick={(event) => {
                event.preventDefault();
                const focusField = () => {
                  document.getElementById(field.inputId)?.focus();
                };
                if (field.field.advanced) {
                  const disclosure =
                    document.getElementById(advancedDisclosureId);
                  if (disclosure instanceof HTMLDetailsElement) {
                    disclosure.open = true;
                    queueMicrotask(focusField);
                    return;
                  }
                }
                focusField();
              }}
            >
              {field.field.label}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigurationPreview({
  model,
  onApplyError,
  onApplied,
}: {
  readonly model: SelectedResourceInspectorModel;
  readonly onApplyError: (message: string) => void;
  readonly onApplied: () => void;
}) {
  const session = useReadyEditorDocumentSession();
  const preview = session.configurationPreview;
  if (
    preview?.target.kind !== model.target.kind ||
    preview.target.id !== model.target.id
  ) {
    return null;
  }

  return (
    <section
      aria-labelledby="configuration-preview-title"
      className="selected-inspector__preview"
    >
      <p className="status-label">Your changes</p>
      <h4 id="configuration-preview-title">Review before applying</h4>
      <p>Apply these changes to your draft. You can undo them afterward.</p>
      <ul className="selected-inspector__change-list">
        {preview.changes.map((change) => (
          <li key={change.property}>
            <strong>
              {model.configuration.fields.find(
                (field) => field.property === change.property,
              )?.label ?? change.property}
            </strong>
            <span>
              {change.before} → {change.after}
            </span>
            {change.sensitive ? (
              <StatusBadge label="Value hidden" tone="read-only" />
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="selected-inspector__hashes">
        <div>
          <dt>Semantic content</dt>
          <dd>Changes after apply</dd>
        </div>
        <div>
          <dt>Visual layout</dt>
          <dd>
            {preview.baseHashes.visualHash === preview.previewHashes.visualHash
              ? "Unchanged"
              : "Unexpected change blocked"}
          </dd>
        </div>
      </dl>
      <div className="selected-inspector__actions">
        <Button
          onClick={() => {
            const result = session.applyConfigurationPreview();
            if (result.ok) {
              onApplied();
            } else {
              onApplyError(result.message);
            }
          }}
          variant="primary"
        >
          Apply configuration
        </Button>
        <Button
          onClick={() => {
            session.discardConfigurationPreview();
          }}
        >
          Discard preview
        </Button>
      </div>
    </section>
  );
}

function implementationModeLabel(
  mode: NonNullable<
    SelectedNodeInspectorModel["workload"]
  >["implementation"]["mode"],
): string {
  switch (mode) {
    case "infrastructure-only":
      return "Infrastructure only";
    case "user-provided":
      return "User-provided implementation";
    case "generated-starter":
      return "Generated starter requested";
    case "complete-supported-pattern":
      return "Complete supported pattern";
    case "ai-assisted-custom":
      return "AI-assisted custom implementation";
    case "external-artifact":
      return "External artifact";
  }
}

function WorkloadOperationForm({
  model,
  operationId,
}: {
  readonly model: SelectedNodeInspectorModel;
  readonly operationId: string;
}) {
  const session = useReadyEditorDocumentSession();
  const workload = model.workload;
  const displayNameId = useId();
  const descriptionId = useId();
  const inputFieldsId = useId();
  const outputFieldsId = useId();
  if (workload === null) {
    return null;
  }
  const resolution = resolveWorkloadOperationDraft({
    document: session.document,
    fallbackDisplayName: `${model.node.presentation.label} behavior`.slice(
      0,
      512,
    ),
    operationId,
    workloadId: workload.id,
  });
  if (!resolution.editable) {
    return <p className="selected-inspector__notice">{resolution.reason}</p>;
  }

  return (
    <WorkloadOperationEditableForm
      key={`${workload.id}:${operationId}:${session.hashes.contentHash}`}
      descriptionId={descriptionId}
      displayNameId={displayNameId}
      initialDraft={resolution.draft}
      inputFieldsId={inputFieldsId}
      model={model}
      operationId={operationId}
      outputFieldsId={outputFieldsId}
    />
  );
}

function WorkloadOperationEditableForm({
  descriptionId,
  displayNameId,
  initialDraft,
  inputFieldsId,
  model,
  operationId,
  outputFieldsId,
}: {
  readonly descriptionId: string;
  readonly displayNameId: string;
  readonly initialDraft: WorkloadOperationDraft;
  readonly inputFieldsId: string;
  readonly model: SelectedNodeInspectorModel;
  readonly operationId: string;
  readonly outputFieldsId: string;
}) {
  const session = useReadyEditorDocumentSession();
  const workload = model.workload;
  const [draft, setDraft] = useState(initialDraft);
  const [preview, setPreview] =
    useState<PreparedWorkloadOperationCommand | null>(null);
  const [error, setError] = useState("");
  if (workload === null) {
    return null;
  }

  const updateDraft = <TKey extends keyof WorkloadOperationDraft>(
    key: TKey,
    value: WorkloadOperationDraft[TKey],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setError("");
  };

  return (
    <form
      className="selected-inspector__behavior-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const prepared = prepareWorkloadOperationCommand({
            commandId: session.createId(),
            document: session.document,
            draft,
            inverseCommandId: session.createId(),
            operationId,
            workloadId: workload.id,
          });
          setPreview(prepared);
          setError("");
        } catch (preparationError) {
          setPreview(null);
          setError(
            preparationError instanceof WorkloadOperationPreparationError
              ? preparationError.message
              : "The operation could not be prepared safely.",
          );
        }
      }}
    >
      <FormField htmlFor={displayNameId} label="Operation name" required>
        <Input
          id={displayNameId}
          maxLength={512}
          onChange={(event) => {
            updateDraft("displayName", event.currentTarget.value);
          }}
          value={draft.displayName}
        />
      </FormField>
      <FormField
        description="What should this function do, and what should it return?"
        htmlFor={descriptionId}
        label="Purpose"
        required
      >
        <Textarea
          className="selected-inspector__purpose-textarea"
          id={descriptionId}
          maxLength={8_000}
          onChange={(event) => {
            updateDraft("description", event.currentTarget.value);
          }}
          rows={3}
          value={draft.description}
        />
      </FormField>
      {error === "" ? null : (
        <p className="selected-inspector__behavior-error" role="alert">
          {error}
        </p>
      )}
      <Disclosure summary="Inputs and outputs (optional)">
        <FormField
          description="Optional. One field per line: name:type:classification:required|optional. Types: string, integer, number, boolean, timestamp, date, uuid, binary-reference."
          htmlFor={inputFieldsId}
          label="Inputs"
        >
          <Textarea
            className="selected-inspector__contract-textarea"
            id={inputFieldsId}
            maxLength={4_096}
            onChange={(event) => {
              updateDraft("inputFields", event.currentTarget.value);
            }}
            placeholder="noteId:uuid:internal:required"
            rows={3}
            spellCheck={false}
            value={draft.inputFields}
          />
        </FormField>
        <FormField
          description="Optional. Uses the same strict field grammar. Blank means this operation declares no output contract."
          htmlFor={outputFieldsId}
          label="Outputs"
        >
          <Textarea
            className="selected-inspector__contract-textarea"
            id={outputFieldsId}
            maxLength={4_096}
            onChange={(event) => {
              updateDraft("outputFields", event.currentTarget.value);
            }}
            placeholder="noteId:uuid:internal:required"
            rows={3}
            spellCheck={false}
            value={draft.outputFields}
          />
        </FormField>
      </Disclosure>
      {preview === null ? null : (
        <div
          aria-label="Prepared workload operation"
          className="selected-inspector__behavior-preview"
        >
          <strong>Ready to apply</strong>
          <span>
            Purpose plus {String(preview.inputFieldCount)} input and{" "}
            {String(preview.outputFieldCount)} output fields. The document has
            not changed.
          </span>
        </div>
      )}
      <div className="selected-inspector__actions">
        {preview === null ? (
          <Button type="submit" variant="secondary">
            Preview purpose and I/O
          </Button>
        ) : (
          <>
            <Button
              onClick={() => {
                const result = session.applyWorkloadOperationCommand(preview);
                if (!result.ok) {
                  setError(result.message);
                  setPreview(null);
                } else {
                  setPreview(null);
                }
              }}
              type="button"
              variant="primary"
            >
              Apply purpose and I/O
            </Button>
            <Button
              onClick={() => {
                setPreview(null);
              }}
              type="button"
            >
              Discard preview
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

function WorkloadOperationEditor({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const workload = model.workload;
  const operationSelectId = useId();
  const [selectedOperationId, setSelectedOperationId] = useState(
    workload?.operations[0]?.id ?? "",
  );
  if (
    workload?.implementation.mode === "infrastructure-only" &&
    workload.operations.length === 0
  )
    return (
      <WorkloadOperationForm
        model={model}
        operationId={defaultPurposeOperationId(workload)}
      />
    );
  if (workload === null || workload.operations.length === 0) {
    return (
      <div className="selected-inspector__behavior-editor">
        <h4>Purpose and I/O</h4>
        <p>No workload operation is declared for this resource.</p>
      </div>
    );
  }
  const operation =
    workload.operations.find(
      (candidate) => candidate.id === selectedOperationId,
    ) ?? workload.operations[0];
  if (operation === undefined) {
    return null;
  }

  return (
    <div className="selected-inspector__behavior-editor">
      <div>
        <p>
          Describe what this function should do. Add inputs and outputs when
          needed.
        </p>
      </div>
      {workload.operations.length > 1 ? (
        <FormField
          htmlFor={operationSelectId}
          label="Workload operation"
          required
        >
          <Select
            id={operationSelectId}
            onChange={(event) => {
              setSelectedOperationId(event.currentTarget.value);
            }}
            value={operation.id}
          >
            {workload.operations.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.capability}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <WorkloadOperationForm
        key={`${workload.id}:${operation.id}`}
        model={model}
        operationId={operation.id}
      />
    </div>
  );
}

function ImplementationSection({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const { mode } = useModePreference();
  const session = useReadyEditorDocumentSession();
  const workload = model.workload;
  if (
    workload === null &&
    resolveExactEditorCatalogService(
      session.document,
      model.node,
      session.catalog,
    )?.defaultWorkload !== "infrastructure-only"
  )
    return null;
  if (model.workloadContractVersion === null) {
    return (
      <section
        aria-label="Implementation readiness"
        className="selected-inspector__section selected-inspector__implementation"
      >
        <Disclosure summary="Implementation: Legacy document">
          <p>
            This document has no implementation-behavior contract. Migration
            does not infer a runtime, handler, trigger, or source.
          </p>
          <p>
            Save a revision to review its available source-generation and export
            options.
          </p>
        </Disclosure>
      </section>
    );
  }
  if (workload === null) {
    return (
      <section
        aria-label="Implementation readiness"
        className="selected-inspector__section selected-inspector__implementation"
      >
        <Disclosure summary="Implementation: Not configured">
          <p>
            No implementation behavior is declared. Runtime, handler, trigger
            dispatch, and source ownership remain unresolved.
          </p>
          <p>
            User-provided code requirement:{" "}
            <strong>unresolved until a workload is explicitly declared</strong>.
          </p>
          {resolveExactEditorCatalogService(
            session.document,
            model.node,
            session.catalog,
          )?.defaultWorkload === "infrastructure-only" ? (
            <ResourceRepairControl
              key={model.node.id}
              nodeId={model.node.id}
              kind="infrastructure-workload"
            />
          ) : null}
          <p>
            Save a revision to review its available source-generation and export
            options.
          </p>
        </Disclosure>
      </section>
    );
  }

  const implementation = workload.implementation;
  const runtime =
    implementation.mode === "infrastructure-only"
      ? "Not declared"
      : implementation.runtimeFamily;
  const handler =
    implementation.mode === "infrastructure-only"
      ? "Not declared"
      : implementation.handler;
  const sourceOwnership =
    implementation.mode === "infrastructure-only"
      ? "No application source declared"
      : implementation.sourceOwnership;
  const codeRequirement =
    implementation.mode === "infrastructure-only"
      ? "No application implementation is declared."
      : implementation.mode === "external-artifact"
        ? "An externally owned artifact is required."
        : implementation.mode === "user-provided"
          ? "User-owned application code is required."
          : "Application code is required. Review generation support when exporting a saved revision.";
  const operations = new Map(
    workload.operations.map((operation) => [operation.id, operation]),
  );
  const edgeDescription = (edgeId: string): string => {
    const edge = session.document.edges.find(
      (candidate) => candidate.id === edgeId,
    );
    if (edge === undefined) {
      return "Referenced relationship is not present";
    }
    const source =
      session.document.nodes.find(
        (node) => node.id === edge.semantic.source.nodeId,
      )?.presentation.label ?? "Unknown source";
    const target =
      session.document.nodes.find(
        (node) => node.id === edge.semantic.target.nodeId,
      )?.presentation.label ?? "Unknown target";
    return `${source} to ${target}`;
  };

  return (
    <section
      aria-label="Implementation readiness"
      className="selected-inspector__section selected-inspector__implementation"
    >
      <Disclosure
        className="selected-inspector__implementation-disclosure"
        summary={
          <span className="selected-inspector__badges">
            <span>Implementation</span>
            <StatusBadge label="Workload Behavior v2" tone="info" />
          </span>
        }
      >
        <div className="selected-inspector__implementation-content">
          <dl className="selected-inspector__implementation-grid">
            <div>
              <dt>Mode</dt>
              <dd>{implementationModeLabel(implementation.mode)}</dd>
            </div>
            <div>
              <dt>Runtime family</dt>
              <dd>{runtime}</dd>
            </div>
            <div>
              <dt>Handler</dt>
              <dd>{handler}</dd>
            </div>
            <div>
              <dt>Source ownership</dt>
              <dd>{sourceOwnership}</dd>
            </div>
            <div>
              <dt>User code requirement</dt>
              <dd>{codeRequirement}</dd>
            </div>
            <div>
              <dt>Starter source generation</dt>
              <dd>Review available options when exporting a saved revision.</dd>
            </div>
          </dl>
          <h4>Bound triggers</h4>
          {workload.triggers.length === 0 ? (
            <p>No trigger binding is declared.</p>
          ) : (
            <ul aria-label="Bound workload triggers">
              {workload.triggers.map((binding) => {
                const operation = operations.get(binding.targetOperationId);
                return (
                  <li key={binding.id}>
                    <span>
                      <strong>{edgeDescription(binding.edgeId)}</strong>
                      <span>
                        Target behavior:{" "}
                        {operation?.capability ??
                          "Referenced operation is missing"}
                        .
                      </span>
                      <span>
                        {" "}
                        Binding {binding.id}; edge {binding.edgeId}; operation{" "}
                        {binding.targetOperationId}.
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {workload.triggers.length > 1 &&
          workload.triggerDispatch.mode === "single" ? (
            <p className="selected-inspector__notice">
              {mode === "guided"
                ? "This workload receives more than one trigger. Separate functions are safer when their event contracts differ; the editor never guesses the event type."
                : "Review the explicit trigger-dispatch contract for these heterogeneous triggers."}{" "}
              <span>
                Trigger dispatch mode: {workload.triggerDispatch.mode}. Multiple
                heterogeneous triggers require an explicit supported dispatcher
                operation.
              </span>
            </p>
          ) : null}
          <h4>Allowed downstream actions</h4>
          {workload.downstreamActions.length === 0 ? (
            <p>No downstream action binding is declared.</p>
          ) : (
            <ul aria-label="Bound downstream workload actions">
              {workload.downstreamActions.map((binding) => {
                const operation = operations.get(binding.sourceOperationId);
                return (
                  <li key={binding.id}>
                    <span>
                      <strong>{edgeDescription(binding.edgeId)}</strong>
                      <span>
                        Source behavior:{" "}
                        {operation?.capability ??
                          "Referenced operation is missing"}
                        .
                      </span>
                      <span>
                        {" "}
                        Binding {binding.id}; edge {binding.edgeId}; operation{" "}
                        {binding.sourceOperationId}.
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <h4>Behavior decisions</h4>
          <p>
            Error behavior: {workload.errorBehavior.mode.replaceAll("-", " ")}.
            Timeout:{" "}
            {workload.executionAssumptions.timeout.kind === "duration"
              ? `${String(workload.executionAssumptions.timeout.milliseconds)} ms`
              : "unresolved"}
            . Retry:{" "}
            {workload.executionAssumptions.retry.kind === "bounded"
              ? `up to ${String(workload.executionAssumptions.retry.maximumAttempts)} attempts`
              : workload.executionAssumptions.retry.kind}
            .
          </p>
          <p>
            Environment bindings: {String(workload.environment.length)}{" "}
            reference-only{" "}
            {workload.environment.length === 1 ? "binding" : "bindings"}. Secret
            values and source are never read by this Inspector.
          </p>
          {workload.unresolvedRequirementIds.length === 0 ? (
            <p>No unresolved implementation requirement is declared.</p>
          ) : (
            <p>
              {String(workload.unresolvedRequirementIds.length)} implementation{" "}
              {workload.unresolvedRequirementIds.length === 1
                ? "decision remains"
                : "decisions remain"}
              : {workload.unresolvedRequirementIds.join(", ")}.
            </p>
          )}
        </div>
      </Disclosure>
    </section>
  );
}

function ConfigurePanel({
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const formModel = useMemo(
    () => createConfigurationFormModel(session.document, model),
    [model, session.document],
  );
  const bufferKey = createConfigurationFormBufferKey(
    model.target,
    model.configuration.schemaId,
    model.configuration.schemaVersion,
  );
  const advancedDisclosureId = `${bufferKey}-advanced-fields`;
  const errorSummaryId = `${bufferKey}-error-summary`;
  const initialBuffer = useMemo(
    () => store.getState().configurationFormBuffers.get(bufferKey),
    [bufferKey, store],
  );
  const resolver = useMemo<Resolver<MutableConfigurationFormValues>>(
    () => (values) => {
      const conversion = convertConfigurationFormValues(formModel, values);
      if (conversion.success) {
        return { errors: {}, values };
      }
      const errors: FieldErrors<MutableConfigurationFormValues> = {};
      for (const issue of conversion.issues) {
        if (
          issue.property !== undefined &&
          errors[issue.property] === undefined
        ) {
          errors[issue.property] = {
            message: issue.message,
            type: "catalog",
          };
        }
      }
      const globalMessages = [
        ...new Set(
          conversion.issues.flatMap((issue) =>
            issue.property === undefined ? [issue.message] : [],
          ),
        ),
      ];
      if (globalMessages.length > 0) {
        errors.root = {
          catalog: {
            message: globalMessages.join(" "),
            type: "catalog",
          },
        };
      }
      return { errors, values: {} };
    },
    [formModel],
  );
  const form = useForm<MutableConfigurationFormValues>({
    defaultValues: structuredClone(
      (initialBuffer?.values ??
        formModel.initialValues) as MutableConfigurationFormValues,
    ),
    // Blur validation can move Review changes between pointer-down and click.
    mode: "onSubmit",
    resolver,
    shouldUnregister: false,
  });
  const [showErrors, setShowErrors] = useState(
    initialBuffer?.shouldValidate ?? false,
  );
  const [commandError, setCommandError] = useState("");

  useEffect(() => {
    if (showErrors) {
      void form.trigger();
    }
  }, [form, showErrors]);

  useEffect(() => {
    const unsubscribe = form.subscribe({
      callback: ({ values }) => {
        store.getState().setConfigurationFormBuffer(bufferKey, {
          shouldValidate: showErrors,
          values,
        });
      },
      formState: { values: true },
    });
    return unsubscribe;
  }, [bufferKey, form, showErrors, store]);

  const focusErrorSummary = () => {
    queueMicrotask(() => {
      document.getElementById(errorSummaryId)?.focus();
    });
  };

  const submit = form.handleSubmit(
    (values) => {
      setShowErrors(true);
      store.getState().setConfigurationFormBuffer(bufferKey, {
        shouldValidate: true,
        values,
      });
      const conversion = convertConfigurationFormValues(formModel, values);
      if (!conversion.success) {
        setCommandError(
          conversion.issues
            .flatMap((issue) =>
              issue.property === undefined ? [issue.message] : [],
            )
            .join(" "),
        );
        for (const issue of conversion.issues) {
          if (issue.property !== undefined) {
            form.setError(issue.property, {
              message: issue.message,
              type: "catalog",
            });
          }
        }
        focusErrorSummary();
        return;
      }
      const result = session.previewConfiguration(
        model.target,
        conversion.edits,
      );
      if (!result.ok) {
        setCommandError(result.message);
        for (const issue of result.issues) {
          if (issue.property !== undefined) {
            form.setError(issue.property, {
              message: issue.message,
              type: "command",
            });
          }
        }
      } else {
        setCommandError("");
      }
    },
    () => {
      setShowErrors(true);
      store.getState().setConfigurationFormBuffer(bufferKey, {
        shouldValidate: true,
        values: form.getValues(),
      });
      focusErrorSummary();
    },
  );

  return (
    <div className="panel-tab-content selected-inspector__tab">
      <div className="selected-inspector__form-intro">
        <h3>Configure {model.title}</h3>
      </div>
      {model.kind === "node" && model.workload !== null ? (
        <section
          aria-label="Application behavior"
          className="selected-inspector__priority"
        >
          <h4>Application function</h4>
          <WorkloadOperationEditor model={model} />
        </section>
      ) : null}
      {model.kind === "node" &&
      model.service.ownedConfigurationSlots?.some((slot) =>
        slot.policyKinds.includes("identity-inline"),
      ) ? (
        <OwnedConfigurationPanel model={model} />
      ) : null}
      {model.kind === "node" ? (
        <ServiceConfigurationNavigation key={model.node.id} model={model} />
      ) : null}
      {showErrors ? (
        <div>
          <ErrorSummary
            advancedDisclosureId={advancedDisclosureId}
            errors={form.formState.errors}
            fields={formModel.fields}
            summaryId={errorSummaryId}
          />
        </div>
      ) : null}
      {commandError === "" ? null : (
        <p className="selected-inspector__error-summary" role="alert">
          {commandError}
        </p>
      )}
      <form
        className="selected-inspector__form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="selected-inspector__field-group">
          {formModel.recommendedFields.map((field) => (
            <ConfigurationInput
              fieldModel={field}
              form={form}
              key={field.field.property}
              model={formModel}
            />
          ))}
        </div>
        {formModel.advancedFields.length === 0 ? null : (
          <AdvancedConfigurationFields
            disclosureId={advancedDisclosureId}
            fields={formModel.advancedFields}
            form={form}
            model={formModel}
          />
        )}
        {formModel.fixedFields.length === 0 ? null : (
          <AdvancedConfigurationFields
            disclosureId={`${advancedDisclosureId}-fixed`}
            fields={formModel.fixedFields}
            form={form}
            model={formModel}
            label="Fixed settings"
          />
        )}
        <div className="selected-inspector__actions">
          <Button type="submit" variant="primary">
            Review changes
          </Button>
          <Button
            onClick={() => {
              session.discardConfigurationPreview();
              form.reset(
                structuredClone(
                  formModel.initialValues as MutableConfigurationFormValues,
                ),
              );
              setShowErrors(false);
              setCommandError("");
              store.getState().clearConfigurationFormBuffer(bufferKey);
            }}
          >
            Reset fields
          </Button>
        </div>
      </form>
      <ConfigurationPreview
        model={model}
        onApplyError={setCommandError}
        onApplied={() => {
          form.reset(form.getValues());
          setShowErrors(false);
          setCommandError("");
        }}
      />
      {model.kind === "node" &&
      !model.service.ownedConfigurationSlots?.some((slot) =>
        slot.policyKinds.includes("identity-inline"),
      ) ? (
        <OwnedConfigurationPanel model={model} />
      ) : null}
      {model.kind === "node" ? <ImplementationSection model={model} /> : null}
    </div>
  );
}

function RelationshipEndpoint({
  showDetails = false,
  capability,
  exactRelationshipName,
  direction,
  label,
  port,
  relationshipType,
  remotePort,
}: {
  readonly showDetails?: boolean;
  readonly capability?: string;
  readonly exactRelationshipName?: string;
  readonly direction: "Inbound" | "Outbound";
  readonly label: string;
  readonly port: string;
  readonly relationshipType: string;
  readonly remotePort: string;
}) {
  return (
    <li className="selected-inspector__connection">
      {direction === "Inbound" ? (
        <ArrowDownToLine aria-hidden="true" size={18} />
      ) : (
        <ArrowUpFromLine aria-hidden="true" size={18} />
      )}
      <span>
        <strong>{label}</strong>
        <span>
          {exactRelationshipName ?? "Unsupported or unknown relationship"} ·{" "}
          {direction}
        </span>
      </span>
      {showDetails ? (
        <dl className="selected-inspector__information-list">
          <div>
            <dt>Capability and port</dt>
            <dd>
              {capability ?? "Not available"} · {port}
            </dd>
          </div>
          <div>
            <dt>Relationship</dt>
            <dd>{relationshipType}</dd>
          </div>
          <div>
            <dt>Remote port</dt>
            <dd>{remotePort}</dd>
          </div>
        </dl>
      ) : (
        <InspectorLearnButton
          label={`More information about the connection with ${label}`}
        />
      )}
    </li>
  );
}

interface ExistingNodeConnection {
  readonly capability?: string;
  readonly category: EditorConnectionCategory;
  readonly direction: "Inbound" | "Outbound";
  readonly edge: ArchitectureEdge;
  readonly exactRelationshipName?: string;
  readonly label: string;
  readonly port: string;
  readonly remotePort: string;
}

function ExistingNodeConnections({
  model,
  showDetails = false,
}: {
  readonly showDetails?: boolean;
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const connections = session.document.edges.flatMap(
    (edge): readonly ExistingNodeConnection[] => {
      const relationship = resolveExactEditorCatalogRelationship(
        session.document,
        edge,
        session.catalog,
      );
      if (edge.semantic.source.nodeId === model.node.id) {
        const target = session.document.nodes.find(
          (node) => node.id === edge.semantic.target.nodeId,
        );
        const capability = model.service.ports.find(
          (port) => port.id === edge.semantic.source.port,
        )?.capability;
        return [
          {
            ...(capability === undefined ? {} : { capability }),
            category: relationship?.category ?? ("other" as const),
            direction: "Outbound" as const,
            edge,
            ...(relationship === undefined
              ? {}
              : { exactRelationshipName: relationship.displayName }),
            label: target?.presentation.label ?? edge.semantic.target.nodeId,
            port: edge.semantic.source.port,
            remotePort: edge.semantic.target.port,
          },
        ];
      }
      if (edge.semantic.target.nodeId === model.node.id) {
        const source = session.document.nodes.find(
          (node) => node.id === edge.semantic.source.nodeId,
        );
        const capability = model.service.ports.find(
          (port) => port.id === edge.semantic.target.port,
        )?.capability;
        return [
          {
            ...(capability === undefined ? {} : { capability }),
            category: relationship?.category ?? ("other" as const),
            direction: "Inbound" as const,
            edge,
            ...(relationship === undefined
              ? {}
              : { exactRelationshipName: relationship.displayName }),
            label: source?.presentation.label ?? edge.semantic.source.nodeId,
            port: edge.semantic.target.port,
            remotePort: edge.semantic.source.port,
          },
        ];
      }
      return [];
    },
  );

  const groups = EDITOR_CONNECTION_CATEGORY_ORDER.flatMap((category) => {
    const members = connections.filter(
      (connection) => connection.category === category,
    );
    return members.length === 0 ? [] : [{ category, members }];
  });
  return connections.length === 0 ? (
    <EmptyState
      description="No typed relationships currently reference this resource."
      headingLevel={4}
      title="No existing connections"
    />
  ) : (
    <>
      <div
        aria-label="Existing typed relationships"
        className="selected-inspector__connection-groups"
      >
        {groups.map(({ category, members }) => (
          <section key={category}>
            <h4>{editorConnectionCategoryLabel(category)}</h4>
            <ul className="selected-inspector__connections">
              {members.map((connection) => (
                <RelationshipEndpoint
                  {...(connection.capability === undefined
                    ? {}
                    : { capability: connection.capability })}
                  showDetails={showDetails}
                  direction={connection.direction}
                  {...(connection.exactRelationshipName === undefined
                    ? {}
                    : {
                        exactRelationshipName: connection.exactRelationshipName,
                      })}
                  key={connection.edge.id}
                  label={connection.label}
                  port={connection.port}
                  relationshipType={connection.edge.semantic.relationshipType}
                  remotePort={connection.remotePort}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function EdgeConnectionDetail({
  model,
  showDetails = false,
}: {
  readonly showDetails?: boolean;
  readonly model: SelectedEdgeInspectorModel;
}) {
  const { mode } = useModePreference();
  const session = useReadyEditorDocumentSession();
  const relationship = model.relationship;
  const sourceService = resolveExactEditorCatalogService(
    session.document,
    model.sourceNode,
    session.catalog,
  );
  const targetService = resolveExactEditorCatalogService(
    session.document,
    model.targetNode,
    session.catalog,
  );
  const sourceCapability = sourceService?.ports.find(
    (port) => port.id === model.edge.semantic.source.port,
  )?.capability;
  const targetCapability = targetService?.ports.find(
    (port) => port.id === model.edge.semantic.target.port,
  )?.capability;
  const matchingRuleEdges = session.document.edges.filter((edge) => {
    const edgeSource = session.document.nodes.find(
      (node) => node.id === edge.semantic.source.nodeId,
    );
    const edgeTarget = session.document.nodes.find(
      (node) => node.id === edge.semantic.target.nodeId,
    );
    return (
      edgeSource?.semantic.serviceType === relationship.sourceServiceType &&
      edgeTarget?.semantic.serviceType === relationship.targetServiceType &&
      edge.semantic.relationshipType === relationship.id &&
      edge.semantic.source.port === relationship.sourcePortId &&
      edge.semantic.target.port === relationship.targetPortId
    );
  });
  const sourceRuleCount = matchingRuleEdges.filter(
    (edge) => edge.semantic.source.nodeId === model.sourceNode.id,
  ).length;
  const targetRuleCount = matchingRuleEdges.filter(
    (edge) => edge.semantic.target.nodeId === model.targetNode.id,
  ).length;
  const endpointPairCount = matchingRuleEdges.filter(
    (edge) =>
      edge.semantic.source.nodeId === model.sourceNode.id &&
      edge.semantic.target.nodeId === model.targetNode.id,
  ).length;
  return (
    <>
      <ul
        aria-label="Relationship endpoints"
        className="selected-inspector__connections"
      >
        <RelationshipEndpoint
          showDetails={showDetails}
          {...(sourceCapability === undefined
            ? {}
            : { capability: sourceCapability })}
          direction="Outbound"
          exactRelationshipName={relationship.displayName}
          label={model.sourceNode.presentation.label}
          port={model.edge.semantic.source.port}
          relationshipType={model.edge.semantic.relationshipType}
          remotePort={model.edge.semantic.target.port}
        />
        <RelationshipEndpoint
          showDetails={showDetails}
          {...(targetCapability === undefined
            ? {}
            : { capability: targetCapability })}
          direction="Inbound"
          exactRelationshipName={relationship.displayName}
          label={model.targetNode.presentation.label}
          port={model.edge.semantic.target.port}
          relationshipType={model.edge.semantic.relationshipType}
          remotePort={model.edge.semantic.source.port}
        />
      </ul>
      <section className="selected-inspector__section">
        <h4>Cardinality utilization</h4>
        <dl className="selected-inspector__implementation-grid">
          <div>
            <dt>Rule from source</dt>
            <dd>
              {String(sourceRuleCount)} /{" "}
              {String(relationship.maximumConnectionsPerSource)}
            </dd>
          </div>
          <div>
            <dt>Rule to target</dt>
            <dd>
              {String(targetRuleCount)} /{" "}
              {String(relationship.maximumConnectionsPerTarget)}
            </dd>
          </div>
          <div>
            <dt>Exact endpoint pair</dt>
            <dd>
              {String(endpointPairCount)} /{" "}
              {String(relationship.maximumConnectionsPerEndpointPair)}
            </dd>
          </div>
        </dl>
      </section>
      <section className="selected-inspector__section">
        <h4>Required configuration</h4>
        {relationship.configuration.fields.length === 0 ? (
          <p>No relationship configuration fields are declared.</p>
        ) : (
          <ul>
            {relationship.configuration.fields.map((field) => (
              <li key={field.property}>
                <strong>{field.label}</strong> ·{" "}
                {field.required ? "required" : "optional"}
              </li>
            ))}
          </ul>
        )}
        {relationship.questions.length === 0 ? null : (
          <>
            <h4>Catalog questions</h4>
            <ul>
              {relationship.questions.map((question) => (
                <li key={question.id}>
                  <strong>{question.prompt}</strong>{" "}
                  {question.answer.kind === "catalog-default"
                    ? "Catalog default available."
                    : question.answer.reason}
                  <span> {question.explanation}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="selected-inspector__section">
        <h4>Generated resources</h4>
        {relationship.supportingChanges.length === 0 ? (
          <p>No generated supporting resources are declared.</p>
        ) : (
          <ul>
            {relationship.supportingChanges.map((change) => (
              <li key={change.id}>
                <strong>{change.kind}</strong> · {change.purpose} · generated
                ownership
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="selected-inspector__section"
        id={`connection-permission-implications-${model.edge.id}`}
        tabIndex={-1}
      >
        <h4>Permission implications</h4>
        {relationship.iamEffects.length === 0 ? (
          <p>No permission effects are declared by this descriptor.</p>
        ) : (
          <ul aria-label="Permission consequences">
            {relationship.iamEffects.map((effect) => (
              <li key={effect.id}>
                <LockKeyhole aria-hidden="true" size={16} />
                <span>
                  <strong>{effect.effect}</strong> · {effect.explanation}
                  <span> Actions: {effect.actions.join(", ")}.</span>
                  <span>
                    {" "}
                    Resource scope: {effect.resourceScope.replaceAll("-", " ")}.
                  </span>
                  {effect.principal === undefined ? null : (
                    <span> Principal: {effect.principal}.</span>
                  )}
                  {effect.when === undefined ? null : (
                    <span>
                      {" "}
                      Applies when {effect.when.property} equals{" "}
                      {String(effect.when.equals)}.
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}{" "}
      </section>
      {relationship.missingInformation.length === 0 ? null : (
        <section className="selected-inspector__section">
          <h4>Potential missing information</h4>
          <p>
            These are catalog-declared conditions. This inspector does not
            evaluate or resolve them.
          </p>
          <ul>
            {relationship.missingInformation.map((item) => (
              <li key={item.code}>
                <strong>
                  {mode === "guided"
                    ? item.guidedMessage
                    : item.professionalMessage}
                </strong>
                <span> Diagnostic {item.code}.</span>
                <span>
                  {" "}
                  Trigger: {item.trigger.replaceAll("-", " ")}.
                  {item.configurationProperties.length === 0
                    ? ""
                    : ` Configuration: ${item.configurationProperties.join(", ")}.`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="selected-inspector__section">
        <h4>Relationship lifecycle</h4>
        <dl className="editor-inspector-list">
          <div>
            <dt>Customization</dt>
            <dd>{relationship.lifecycle.adoption.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Deletion</dt>
            <dd>{relationship.lifecycle.deletion.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Shared resources</dt>
            <dd>
              {relationship.lifecycle.sharedResource.replaceAll("-", " ")}
            </dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd>{relationship.lifecycle.provenance.replaceAll("-", " ")}</dd>
          </div>
        </dl>
      </section>
      <p className="selected-inspector__notice">
        Descriptor {relationship.descriptorId} @ {relationship.ruleVersion} ·{" "}
        {relationship.implementation.status === "implemented"
          ? "reviewed implementation declared"
          : relationship.implementation.reason}
      </p>{" "}
    </>
  );
}

function ActionableConnectionCapabilities({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const ports = model.service.ports.filter(
    (port) => port.connectionSupport === "supported",
  );
  const groups = EDITOR_CONNECTION_CATEGORY_ORDER.flatMap((category) => {
    const members = ports.filter((port) => port.category === category);
    return members.length === 0 ? [] : [{ category, members }];
  });

  if (groups.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Available connection actions"
      className="selected-inspector__section"
    >
      <Disclosure summary={`Connection options (${String(ports.length)})`}>
        <p>Choose a capability to narrow the compatible targets.</p>
        <div className="selected-inspector__capability-groups">
          {groups.map(({ category, members }) => (
            <section key={category}>
              <h5>{editorConnectionCategoryLabel(category)}</h5>
              <ul className="selected-inspector__capability-actions">
                {members.map((port) => (
                  <li key={port.id}>
                    <Link2 aria-hidden="true" size={16} />
                    <span className="selected-inspector__capability-copy">
                      <strong>{port.displayName}</strong>
                      <span>{port.description}</span>
                    </span>
                    <InspectorLearnButton
                      label={`More information about ${port.displayName}`}
                    />
                    <Button
                      aria-label={
                        "Connect " +
                        model.title +
                        " using " +
                        port.displayName +
                        " " +
                        port.direction +
                        " capability"
                      }
                      onClick={() => {
                        session.beginConnection({
                          direction: port.direction,
                          kind: "port",
                          nodeId: model.node.id,
                          portId: port.id,
                        });
                      }}
                      size="compact"
                      variant="quiet"
                    >
                      Connect
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Disclosure>
    </section>
  );
}

function ConnectPanel({
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
}) {
  const session = useReadyEditorDocumentSession();
  const canEditGeneratedConnection =
    model.kind === "edge" &&
    model.edge.semantic.lifecycle.ownership === "generated" &&
    model.edge.semantic.lifecycle.provenance.generatorKind ===
      "connection-rule";
  const canStartNodeConnection =
    model.kind === "node" &&
    model.service.ports.some((port) => port.connectionSupport === "supported");

  return (
    <div className="panel-tab-content selected-inspector__tab">
      <div>
        <p className="status-label">Connections</p>
        <h3>Connect {model.title}</h3>
        <p>Review current connections or start a compatible connection.</p>
      </div>
      <div className="selected-inspector__actions">
        {model.kind === "node" || canEditGeneratedConnection ? (
          <Button
            disabled={model.kind === "node" && !canStartNodeConnection}
            onClick={() => {
              session.beginConnection(
                model.kind === "node"
                  ? { kind: "node", nodeId: model.node.id }
                  : { edgeId: model.edge.id, kind: "edge" },
              );
            }}
          >
            {model.kind === "node"
              ? `Connect ${model.title}`
              : "Manage connection"}
          </Button>
        ) : null}
        {model.kind === "node" ? (
          <ActionableConnectionCapabilities model={model} />
        ) : null}
        {model.kind === "edge" &&
        model.edge.semantic.lifecycle.ownership === "user" ? (
          <Button
            onClick={() => session.disconnectEdge(model.edge.id)}
            variant="secondary"
          >
            Remove connection
          </Button>
        ) : null}
      </div>
      {model.kind === "edge" && !canEditGeneratedConnection ? (
        <p>
          {model.edge.semantic.lifecycle.ownership === "user"
            ? "Use Configure to change this connection’s settings. Removal can be undone."
            : "This adopted connection needs an ownership review before it can be removed."}
        </p>
      ) : null}
      {model.kind === "node" ? (
        <>
          <ExistingNodeConnections model={model} />
        </>
      ) : (
        <EdgeConnectionDetail model={model} />
      )}
    </div>
  );
}

function LearnPanel({
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
}) {
  const { mode } = useModePreference();
  const session = useReadyEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const shell = useWorkspaceShellController();
  const securityFields = model.configuration.fields.filter(
    (field) => field.securityImpact !== "none",
  );
  const costFields = model.configuration.fields.filter(
    (field) => field.costImpact === "cost-sensitive",
  );
  const officialDocumentation = model.education.documentation.filter(
    (reference): reference is Extract<typeof reference, { kind: "official" }> =>
      reference.kind === "official" && reference.href.startsWith("https://"),
  );
  const considerations = model.education.considerations.map((consideration) => {
    const separator = consideration.indexOf(":");
    const candidateLabel =
      separator > 0 ? consideration.slice(0, separator).trim() : "";
    const recognizedLabel = [
      "Connections",
      "Cost",
      "Operations",
      "Security",
    ].includes(candidateLabel);
    return {
      detail: recognizedLabel
        ? consideration.slice(separator + 1).trim()
        : consideration,
      label: recognizedLabel ? candidateLabel : "Service guidance",
    };
  });

  return (
    <div className="panel-tab-content selected-inspector__tab">
      <Disclosure summary="How is compatibility determined?">
        <p>
          Compatibility, direction, questions, effects, and the atomic preview
          come from the version-bound connection engine. Nothing changes until
          confirmation.
        </p>
      </Disclosure>
      <header className="selected-inspector__learn-intro">
        <p className="status-label">Service guidance</p>
        <h3>Learn about {model.title}</h3>
        <p>{model.education.summary}</p>
        <p className="selected-inspector__audience-guidance">
          {mode === "guided"
            ? model.education.guidedExplanation
            : model.education.professionalExplanation}
        </p>
      </header>
      <Disclosure summary="Placement and connection guidance">
        <p>
          Boundaries group related resources. Apply a valid parent in Configure
          to change placement; moving a service visually does not change its
          configuration.
        </p>
        {model.kind === "node" ? (
          <>
            <ExistingNodeConnections model={model} showDetails />
            <ul>
              {model.service.ports.map((port) => (
                <li key={port.id}>
                  <strong>{port.displayName}</strong> — {port.description}.{" "}
                  {port.direction === "input"
                    ? "Receives a connection"
                    : "Starts an outgoing connection"}
                  ;{" "}
                  {port.cardinality === "one"
                    ? "one connection"
                    : "multiple connections"}
                  . <code>{port.id}</code>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EdgeConnectionDetail model={model} showDetails />
        )}
      </Disclosure>

      {model.kind === "node"
        ? projectArchitectureOwnedConfigurationSummaries(
            session.document,
            session.catalog,
            model.node,
            model.service,
          )
            .filter((summary) => summary.count > 0)
            .map((summary) => (
              <Disclosure
                key={summary.slotId}
                data-owned-configuration-slot={summary.slotId}
                summary={summary.label + " (" + String(summary.count) + ")"}
              >
                <p>{summary.description}</p>
                <ul>
                  {summary.entries.map((entry) => (
                    <li
                      key={entry.nodeId}
                      data-configuration-node-id={entry.nodeId}
                    >
                      <strong>{entry.label}</strong>
                      {entry.facts.map((fact) => (
                        <p key={fact.label}>
                          {fact.label}: {fact.value}
                        </p>
                      ))}
                      {entry.associations.map((association) => (
                        <p
                          key={association.edgeId}
                          data-architecture-edge-id={association.edgeId}
                        >
                          {association.label}: {association.remoteNodeLabel}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ))
        : null}
      <Button
        onClick={() => {
          const targetId =
            model.kind === "node"
              ? `validation-architecture-node-${model.node.id}`
              : `validation-architecture-edge-${model.edge.id}`;
          store.getState().setSelection(model.target);
          shell?.focusArchitectureTarget(targetId);
          window.setTimeout(() => {
            const target = document.getElementById(targetId);
            target?.focus();
            const focused = document.activeElement === target;
            store
              .getState()
              .announce(
                focused
                  ? `Focused ${model.title} in the synchronized architecture list.`
                  : `${model.title} is selected, but focus could not move to the synchronized architecture list.`,
              );
          }, 0);
        }}
        type="button"
        variant="secondary"
      >
        Show me on the architecture
      </Button>
      <section className="selected-inspector__section">
        <h4>What to review</h4>
        <dl className="selected-inspector__learning-grid">
          {considerations.map((consideration, index) => (
            <div key={`${consideration.label}-${String(index)}`}>
              <dt>{consideration.label}</dt>
              <dd>{consideration.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="selected-inspector__section">
        <h4>Configuration signals</h4>
        <dl className="selected-inspector__signal-grid">
          <div>
            <dt>Security-sensitive fields</dt>
            <dd>
              {securityFields.length === 0
                ? "None declared; this is not a security approval."
                : securityFields.map((field) => field.label).join(", ")}
            </dd>
          </div>
          <div>
            <dt>Cost-sensitive fields</dt>
            <dd>
              {costFields.length === 0
                ? "None declared; provider charges may still apply."
                : costFields.map((field) => field.label).join(", ")}
            </dd>
          </div>
        </dl>
      </section>
      <section className="selected-inspector__section">
        <h4>Reliability and availability</h4>
        {model.kind === "node" ? (
          model.service.regionAvailability.state === "unknown" ? (
            <p>
              <AlertTriangle aria-hidden="true" size={16} /> Region availability
              unknown. {model.service.regionAvailability.reason}
            </p>
          ) : (
            <p>
              Region metadata is {model.service.regionAvailability.coverage}.
              Verify the selected deployment Region.
            </p>
          )
        ) : (
          <p>
            Relationship availability follows its exact endpoint services and is
            not independently inferred here.
          </p>
        )}
        <p>
          No service-level objective or reliability guarantee is inferred beyond
          the exact catalog availability state and considerations above.
        </p>
      </section>
      <Disclosure summary="Architecture context">
        <div className="selected-inspector__learn-disclosure">
          <section>
            <h4>Assumptions</h4>
            {session.document.assumptions.length === 0 ? (
              <p>No document assumptions are recorded.</p>
            ) : (
              <ul>
                {session.document.assumptions.map((assumption) => (
                  <li key={assumption.id}>
                    {assumption.statement} · {assumption.status}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Unresolved questions</h4>
            {session.document.unresolvedRequirements.length === 0 ? (
              <p>No unresolved questions are recorded.</p>
            ) : (
              <ul>
                {session.document.unresolvedRequirements.map((requirement) => (
                  <li key={requirement.id}>
                    {requirement.statement} · {requirement.category}
                    {requirement.blocking ? " · blocking" : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Disclosure>
      <Disclosure summary="Catalog boundaries">
        <div className="selected-inspector__learn-disclosure">
          <p>
            Guidance comes from the exact catalog bound to this document. The
            Inspector does not add provider behavior.
          </p>
          {model.unsupportedCapabilities.length === 0 ? (
            <p>No unsupported capability is declared for this catalog entry.</p>
          ) : (
            <ul>
              {model.unsupportedCapabilities.map((capability) => (
                <li key={capability.id}>
                  <strong>{capability.title}</strong> · {capability.explanation}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Disclosure>
      {officialDocumentation.length === 0 ? null : (
        <section className="selected-inspector__section">
          <h4>Official documentation</h4>
          <p>
            Safe HTTPS links below come directly from the bound provider
            catalog.
          </p>
          <ul>
            {officialDocumentation.map((reference) => (
              <li key={reference.href}>
                <a href={reference.href} rel="noreferrer" target="_blank">
                  <BookOpen aria-hidden="true" size={16} />
                  {reference.title}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NodeIacMappings({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  return model.mappings.length === 0 ? (
    <EmptyState
      description="The bound catalog declares no target mapping for this resource."
      headingLevel={4}
      title="No IaC mappings"
    />
  ) : (
    <ul className="selected-inspector__mapping-list">
      {model.mappings.map((mapping) => (
        <li key={mapping.mappingId}>
          <Disclosure summary={mapping.target}>
            <div>
              <FileCode2 aria-hidden="true" size={18} />
              <span>
                <strong>{mapping.target}</strong>
                <span>{mapping.targetResourceTypeLabel}</span>
              </span>
              <StatusBadge
                label={
                  mapping.implementationStatus === "metadata-only"
                    ? "Export support pending"
                    : "Export mapping available"
                }
                tone={
                  mapping.implementationStatus === "metadata-only"
                    ? "incomplete"
                    : "success"
                }
              />
            </div>
            <dl>
              <div>
                <dt>Mapping ID</dt>
                <dd>{mapping.mappingId}</dd>
              </div>
              <div>
                <dt>Target resource type</dt>
                <dd>{mapping.targetResourceType}</dd>
              </div>
              <div>
                <dt>Graph properties affecting output</dt>
                <dd>
                  {mapping.configurationBindings.length === 0
                    ? "None declared"
                    : mapping.configurationBindings
                        .map(
                          (binding) =>
                            `${binding.property} → ${binding.targetName}`,
                        )
                        .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Port bindings</dt>
                <dd>
                  {mapping.portBindings.length === 0
                    ? "None declared"
                    : mapping.portBindings
                        .map(
                          (binding) =>
                            `${binding.portId} → ${binding.targetAttribute}`,
                        )
                        .join(", ")}
                </dd>
              </div>
            </dl>
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}

function IacPanel({
  model,
}: {
  readonly model: SelectedResourceInspectorModel;
}) {
  return (
    <div className="panel-tab-content selected-inspector__tab">
      <div>
        <p className="status-label">Infrastructure code</p>
        <h3>{model.title}</h3>
        <p>
          Review the export targets for this resource. Save a revision, then
          export to generate and download code.
        </p>
      </div>
      {model.kind === "node" ? (
        <NodeIacMappings model={model} />
      ) : (
        <section className="selected-inspector__section">
          <h4>Relationship effects</h4>
          <p>
            Descriptor {model.relationship.descriptorId} declares{" "}
            {String(model.relationship.supportingChanges.length)} supporting
            changes and {String(model.relationship.iamEffects.length)}{" "}
            permission effects. This UI does not translate them into IaC.
          </p>
          <p>
            Unsupported target features remain unavailable until a compiler
            contract implements the mapping.
          </p>
        </section>
      )}
      {model.unsupportedCapabilities.length > 0 ? (
        <Disclosure summary="Export limitations">
          <ul>
            {model.unsupportedCapabilities.map((capability) => (
              <li key={capability.id}>
                <strong>{capability.title}</strong> {capability.explanation}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

function UnavailablePanel({
  resolution,
}: {
  readonly resolution: Extract<
    SelectedResourceInspectorResolution,
    { kind: "unavailable" }
  >;
}) {
  return (
    <div className="panel-tab-content selected-inspector__tab">
      <p className="status-label">Safe fallback</p>
      <h3>{resolution.title}</h3>
      <p>{resolution.reason}</p>
      <p>The Architecture Document was not changed.</p>
    </div>
  );
}

function NoSelectionPanel() {
  return (
    <div className="panel-tab-content selected-inspector__tab">
      <EmptyState
        description="Select a node or relationship through the canvas or architecture list. Selection is presentation state and does not change the document."
        headingLevel={3}
        title="No resource selected"
      />
    </div>
  );
}

export function SelectedResourceInspector({
  activeTab,
  onActiveTabChange,
}: {
  readonly activeTab: SelectedResourceInspectorTab;
  readonly onActiveTabChange: (tab: SelectedResourceInspectorTab) => void;
}) {
  const session = useEditorDocumentSession();
  const selection = useEditorSessionState((state) => state.selection);
  const resolution = useMemo(
    () =>
      session.status === "ready" && selection !== null
        ? resolveSelectedResourceInspectorModel(
            session.document,
            session.catalog,
            selection,
          )
        : null,
    [selection, session],
  );

  return (
    <div
      className="selected-inspector"
      id="selected-resource-inspector"
      tabIndex={-1}
    >
      {resolution?.kind === "ready" ? (
        <SelectedOverview
          showTechnicalIdentity={activeTab === "learn"}
          key={`${resolution.model.target.kind}:${resolution.model.target.id}`}
          model={resolution.model}
        />
      ) : null}
      <Tabs
        ariaLabel="Inspector sections"
        items={inspectorTabs.map(([id, label]) => ({
          id,
          label,
          panel:
            resolution === null ? (
              <NoSelectionPanel />
            ) : resolution.kind === "unavailable" ? (
              <UnavailablePanel resolution={resolution} />
            ) : id === "configure" ? (
              <ConfigurePanel
                key={`${resolution.model.target.kind}:${resolution.model.target.id}:${resolution.model.configuration.schemaId}@${resolution.model.configuration.schemaVersion}`}
                model={resolution.model}
              />
            ) : id === "connect" ? (
              <ConnectPanel
                key={`${resolution.model.target.kind}:${resolution.model.target.id}`}
                model={resolution.model}
              />
            ) : (
              <LearnPanel model={resolution.model} />
            ),
        }))}
        onValueChange={(tab) => {
          onActiveTabChange(tab as SelectedResourceInspectorTab);
        }}
        size="compact"
        value={activeTab === "iac" ? "configure" : activeTab}
      />
      {resolution?.kind === "ready" && resolution.model.kind === "node" ? (
        <ServiceRemovalControl
          key={resolution.model.node.id}
          model={resolution.model}
        />
      ) : null}
    </div>
  );
}

/** One code surface shared by every resource action and the workspace. */
export function SelectedResourceCode() {
  const session = useEditorDocumentSession();
  const selection = useEditorSessionState((state) => state.selection);
  const resolution =
    session.status === "ready" && selection !== null
      ? resolveSelectedResourceInspectorModel(
          session.document,
          session.catalog,
          selection,
        )
      : null;
  return resolution === null ? (
    <NoSelectionPanel />
  ) : resolution.kind === "unavailable" ? (
    <UnavailablePanel resolution={resolution} />
  ) : (
    <IacPanel model={resolution.model} />
  );
}
