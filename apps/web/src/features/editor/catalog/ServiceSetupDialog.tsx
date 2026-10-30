import { prepareServiceVariantCommand } from "../model/service-variant-command.js";
import type { PreparedResourceRepair } from "../model/resource-repair-command.js";
import { Button, Dialog, FormField, Select } from "@cloudmarkup/ui";
import {
  useId,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useForm } from "react-hook-form";
import type { ConfigurationValue } from "@cloudmarkup/schemas";

import type { EditorCatalogService } from "../model/editor-catalog.js";
import {
  listServiceCreationParents,
  serviceCreationDefaults,
} from "../model/placement-rules.js";
import { useEditorDocumentSession } from "../session/index.js";
import {
  AdvancedConfigurationFields,
  ConfigurationInput,
} from "../inspector/ConfigurationFields.js";
import {
  convertConfigurationFormValues,
  createConfigurationFormModel,
  type MutableConfigurationFormValues,
} from "../inspector/configuration-form-model.js";

export function ServiceSetupDialog({
  service,
  onClose,
  returnFocusRef,
  parentNodeId,
  replaceNodeId,
}: {
  readonly service: EditorCatalogService;
  readonly parentNodeId?: string;
  readonly replaceNodeId?: string;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const session = useEditorDocumentSession();
  const [serviceType, setServiceType] = useState(service.serviceType);
  const variants = service.catalogGroup
    ? session.catalog.services.filter(
        (candidate) => candidate.catalogGroup?.id === service.catalogGroup?.id,
      )
    : [service];
  const selected =
    variants.find((candidate) => candidate.serviceType === serviceType) ??
    service;
  return session.status === "ready" ? (
    <ServiceSetupForm
      key={selected.serviceType}
      service={selected}
      variantControl={
        variants.length > 1 ? (
          <FormField
            label={service.catalogGroup?.variantLabel ?? "Resource type"}
            htmlFor="service-variant"
          >
            <Select
              id="service-variant"
              value={selected.serviceType}
              onChange={(event) => {
                setServiceType(event.target.value);
              }}
            >
              {variants.map((variant) => (
                <option key={variant.serviceType} value={variant.serviceType}>
                  {variant.displayName}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null
      }
      {...(parentNodeId === undefined ? {} : { parentNodeId })}
      {...(replaceNodeId === undefined ? {} : { replaceNodeId })}
      session={session}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    />
  ) : null;
}

function ServiceSetupForm({
  parentNodeId: ownerNodeId,
  replaceNodeId,
  variantControl,
  service,
  session,
  onClose,
  returnFocusRef,
}: {
  readonly service: EditorCatalogService;
  readonly parentNodeId?: string;
  readonly replaceNodeId?: string;
  readonly variantControl: ReactNode;
  readonly session: Extract<
    ReturnType<typeof useEditorDocumentSession>,
    { status: "ready" }
  >;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const model = useMemo(
    () =>
      createConfigurationFormModel(session.document, {
        configuration: service.configuration,
        currentConfiguration: {
          values: {
            ...serviceCreationDefaults(session.document, service),
            ...Object.fromEntries(
              Object.entries(
                session.document.nodes.find((node) => node.id === replaceNodeId)
                  ?.semantic.configuration.values ?? {},
              ).filter(([property]) =>
                service.configuration.fields.some(
                  (field) => field.property === property,
                ),
              ),
            ),
          },
        },
        target: { kind: "creation", id: service.serviceType },
      }),
    [session.document, service, replaceNodeId],
  );
  const parents = listServiceCreationParents(
    session.document,
    session.catalog,
    service,
  );
  const [parentId, setParentId] = useState(() => {
    const currentParent =
      session.document.nodes.find((node) => node.id === replaceNodeId)?.semantic
        .parent?.nodeId ?? null;
    return (
      (
        parents.find((parent) => parent.parentNodeId === currentParent) ??
        parents[0]
      )?.parentNodeId ?? ""
    );
  });
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreparedResourceRepair | null>(null);
  const form = useForm<MutableConfigurationFormValues>({
    defaultValues: structuredClone(
      model.initialValues,
    ) as MutableConfigurationFormValues,
  });
  const requiredFields = model.recommendedFields;
  const optionalFields = model.advancedFields;

  function submit(values: MutableConfigurationFormValues): void {
    form.clearErrors();
    setError("");
    const result = convertConfigurationFormValues(model, values);
    if (!result.success) {
      for (const issue of result.issues) {
        if (issue.property !== undefined) {
          form.setError(issue.property, {
            type: "validate",
            message: issue.message,
          });
        }
      }
      setError("Check the highlighted settings before adding this service.");
      const first = result.issues.find(
        (issue) => issue.property !== undefined,
      )?.property;
      if (first !== undefined) form.setFocus(first);
      return;
    }
    const configurationValues = Object.fromEntries(
      Object.entries({ ...model.currentValues, ...result.edits }).filter(
        (entry): entry is [string, Readonly<ConfigurationValue>] =>
          entry[1] !== undefined,
      ),
    );
    const parentNodeId = parentId === "" ? null : parentId;
    if (!parents.some((parent) => parent.parentNodeId === parentNodeId)) {
      setError("Choose an available parent for this service.");
      return;
    }
    if (replaceNodeId !== undefined) {
      try {
        if (preview !== null) {
          const result = session.applyReviewedCommand(preview);
          if (result.ok) onClose();
          else setError(result.message);
        } else
          setPreview(
            prepareServiceVariantCommand({
              document: session.document,
              catalog: session.catalog,
              nodeId: replaceNodeId,
              serviceId: service.serviceType,
              configurationValues,
              parentNodeId,
              createId: () => session.createId(),
            }),
          );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The service type could not be changed.",
        );
      }
      return;
    }
    if (ownerNodeId !== undefined) {
      try {
        if (!session.catalog.prepareRelatedService)
          throw new Error("Related settings are unavailable for this catalog.");
        if (preview !== null) {
          const applied = session.applyReviewedCommand(preview);
          if (applied.ok) onClose();
          else setError(applied.message);
        } else
          setPreview(
            session.catalog.prepareRelatedService({
              document: session.document,
              catalog: session.catalog,
              ownerNodeId,
              serviceId: service.serviceType,
              configurationValues,
              createId: () => session.createId(),
            }),
          );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "This setting could not be added.",
        );
      }
      return;
    }
    const added = session.addService(service.serviceType, undefined, {
      configurationValues,
      parentNodeId,
    });
    if (added.ok) onClose();
    else setError(added.message);
  }

  return (
    <Dialog
      className="service-setup-dialog"
      title={`Set up ${service.displayName}`}
      description={service.education.summary}
      open
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={parents.length === 0 && ownerNodeId === undefined}
            form={`${id}-form`}
            type="submit"
            variant="primary"
          >
            {ownerNodeId !== undefined
              ? preview === null
                ? "Review related setting"
                : "Add related setting"
              : replaceNodeId === undefined
                ? "Add to canvas"
                : preview === null
                  ? "Review type change"
                  : "Apply type change"}
          </Button>
        </>
      }
    >
      <form
        className="service-setup-form"
        id={`${id}-form`}
        noValidate
        onChange={() => {
          setPreview(null);
        }}
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        {variantControl}
        {ownerNodeId !== undefined ? null : parents.length > 1 ? (
          <FormField label="Add inside" htmlFor={`${id}-parent`} required>
            <Select
              id={`${id}-parent`}
              value={parentId}
              onChange={(event) => {
                setParentId(event.target.value);
              }}
            >
              {parents.map((parent) => (
                <option
                  key={parent.parentNodeId ?? "root"}
                  value={parent.parentNodeId ?? ""}
                >
                  {parent.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <p>Location: {parents[0]?.label ?? "Add a suitable parent first"}</p>
        )}
        <div className="selected-inspector__field-group">
          {requiredFields.map((field) => (
            <ConfigurationInput
              key={field.field.property}
              fieldModel={field}
              form={form}
              model={model}
            />
          ))}
        </div>
        {optionalFields.length > 0 ? (
          <AdvancedConfigurationFields
            disclosureId={`${id}-advanced`}
            fields={optionalFields}
            form={form}
            model={model}
          />
        ) : null}
        {model.fixedFields.length > 0 ? (
          <AdvancedConfigurationFields
            disclosureId={`${id}-fixed`}
            fields={model.fixedFields}
            form={form}
            model={model}
            label="Fixed settings"
          />
        ) : null}
        {error === "" ? null : <p role="alert">{error}</p>}
        {preview === null ? null : <p role="status">{preview.description}</p>}
      </form>
    </Dialog>
  );
}
