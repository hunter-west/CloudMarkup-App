import {
  Checkbox,
  Disclosure,
  FormField,
  Input,
  Popover,
  Select,
  Textarea,
} from "@cloudmarkup/ui";
import { Info } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWatch, type useForm } from "react-hook-form";
import { useEditorSessionState } from "../session/index.js";
import {
  fieldErrorMessage,
  type MutableConfigurationFormValues,
  type ConfigurationFormFieldModel,
  type createConfigurationFormModel,
} from "./configuration-form-model.js";

function ConfigurationFieldInformation({ field }: ConfigurationFormFieldModel) {
  const informationRef = useRef<HTMLSpanElement>(null);
  const constraints: string[] = [];
  if ("enum" in field.schema) {
    constraints.push(`one of ${field.schema.enum.map(String).join(", ")}`);
  }
  if ("const" in field.schema) {
    constraints.push(`fixed to ${String(field.schema.const)}`);
  }
  switch (field.schema.kind) {
    case "string":
      if (field.schema.pattern !== undefined) {
        constraints.push(`must match ${field.schema.pattern}`);
      }
      if (field.schema.minimumLength !== undefined) {
        constraints.push(
          `minimum ${String(field.schema.minimumLength)} characters`,
        );
      }
      if (field.schema.maximumLength !== undefined) {
        constraints.push(
          `maximum ${String(field.schema.maximumLength)} characters`,
        );
      }
      break;
    case "number":
    case "integer":
      if (field.schema.minimum !== undefined) {
        constraints.push(`minimum ${String(field.schema.minimum)}`);
      }
      if (field.schema.maximum !== undefined) {
        constraints.push(`maximum ${String(field.schema.maximum)}`);
      }
      break;
    case "string-list":
    case "number-list":
    case "integer-list":
      if (field.schema.minimumItems !== undefined) {
        constraints.push(`minimum ${String(field.schema.minimumItems)} items`);
      }
      if (field.schema.maximumItems !== undefined) {
        constraints.push(`maximum ${String(field.schema.maximumItems)} items`);
      }
      if (field.schema.uniqueItems) {
        constraints.push("unique items");
      }
      break;
    case "boolean":
      break;
  }

  return (
    <span ref={informationRef}>
      <Popover
        className="selected-inspector__information"
        label={`${field.label} field information`}
        openOnHoverOrFocus
        renderContent={(content) =>
          createPortal(
            content,
            informationRef.current?.closest("[data-cm-modal-drawer]") ??
              document.body,
          )
        }
        trigger={<Info aria-hidden="true" size={15} />}
        triggerLabel={`More information about ${field.label}`}
      >
        <dl className="selected-inspector__information-list">
          {field.helpText === undefined ? null : (
            <div>
              <dt>Help</dt>
              <dd>{field.helpText}</dd>
            </div>
          )}
          <div>
            <dt>Value source</dt>
            <dd>
              {field.valueSource === "sensitive-variable-reference"
                ? "Sensitive infrastructure variable reference"
                : field.valueSource.replaceAll("-", " ")}
            </dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>
              {constraints.length === 0
                ? "No additional constraint is declared."
                : constraints.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Impact</dt>
            <dd>
              {field.securityImpact === "none"
                ? "No security impact is declared."
                : "Security-sensitive setting."}
              {field.costImpact === "cost-sensitive" ? " May affect cost." : ""}
            </dd>
          </div>
        </dl>
      </Popover>
    </span>
  );
}

function fieldDescription(
  { field, reason }: ConfigurationFormFieldModel,
  showHelp: boolean,
): ReactNode {
  return (
    <>
      {field.helpText === undefined ||
      (!showHelp &&
        field.securityImpact === "none" &&
        field.costImpact !== "cost-sensitive") ? null : (
        <span>{field.helpText} </span>
      )}
      {reason === undefined ? null : <strong>{reason}</strong>}
    </>
  );
}

export function ConfigurationInput({
  fieldModel,
  form,
  model,
}: {
  readonly fieldModel: ConfigurationFormFieldModel;
  readonly form: ReturnType<typeof useForm<MutableConfigurationFormValues>>;
  readonly model: ReturnType<typeof createConfigurationFormModel>;
}) {
  const { compatibleVariables, editable, field, inputId } = fieldModel;
  const validationFocus = useEditorSessionState(
    (state) => state.validationFocus,
  );
  const target = model.selected.target;
  const validationLocation = validationFocus?.location;
  const isValidationTarget =
    validationLocation?.kind === "configuration" &&
    validationLocation.key === field.property &&
    ((target.kind === "node" &&
      validationLocation.owner.kind === "node" &&
      validationLocation.owner.nodeId === target.id) ||
      (target.kind === "edge" &&
        validationLocation.owner.kind === "edge" &&
        validationLocation.owner.edgeId === target.id));
  const validationHighlightAttributes = isValidationTarget
    ? ({ "data-validation-highlight": "true" } as const)
    : {};
  const error = fieldErrorMessage(form.formState.errors, field.property);
  const description =
    (error !== undefined && field.helpText !== undefined) ||
    isValidationTarget ||
    fieldModel.reason !== undefined ||
    (field.helpText !== undefined &&
      (field.securityImpact !== "none" ||
        field.costImpact === "cost-sensitive")) ? (
      <>
        {isValidationTarget ? (
          <strong className="architecture-validation-target-marker">
            Finding target.
          </strong>
        ) : null}
        {fieldDescription(fieldModel, error !== undefined)}
      </>
    ) : undefined;
  const information = <ConfigurationFieldInformation {...fieldModel} />;

  if (!editable) {
    const value = model.initialValues[field.property];
    const visibleValue =
      typeof value === "boolean"
        ? String(value)
        : Array.isArray(value)
          ? value.join(", ")
          : (value ?? "");
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
        tone={field.securityImpact === "none" ? "warning" : "security"}
      >
        <Input id={inputId} readOnly value={visibleValue} />
      </FormField>
    );
  }

  if (field.valueSource === "sensitive-variable-reference") {
    const initial = model.initialValues[field.property];
    const unavailable =
      typeof initial === "string" &&
      initial !== "" &&
      !compatibleVariables.some((variable) => variable.id === initial);
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
        tone="security"
      >
        <Select
          data-sensitive-variable-reference=""
          id={inputId}
          {...form.register(field.property)}
        >
          <option value="">
            {compatibleVariables.length === 0
              ? "No compatible deployment-time variables"
              : "Choose a deployment-time variable"}
          </option>
          {unavailable ? (
            <option value={initial}>Unavailable variable: {initial}</option>
          ) : null}
          {compatibleVariables.map((variable) => (
            <option key={variable.id} value={variable.id}>
              {variable.key} · {variable.valueType}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (
    field.schema.kind === "boolean" &&
    field.control === "checkbox" &&
    model.initialValues[field.property] !== ""
  ) {
    const errorId = `${inputId}-error`;
    return (
      <div
        {...validationHighlightAttributes}
        className="cm-form-field selected-inspector__checkbox-field"
        data-tone={error === undefined ? "default" : "error"}
      >
        <Checkbox
          {...form.register(field.property)}
          aria-describedby={error === undefined ? undefined : errorId}
          aria-invalid={error === undefined ? undefined : true}
          description={description}
          inputId={inputId}
          label={
            <>
              {field.label}
              {field.required ? (
                <span className="cm-form-field__required">Required</span>
              ) : null}
            </>
          }
        />
        <div className="selected-inspector__checkbox-information">
          {information}
        </div>
        {error === undefined ? null : (
          <div className="cm-form-field__error" id={errorId}>
            {error}
          </div>
        )}
      </div>
    );
  }

  if (field.schema.kind === "boolean") {
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
      >
        <Select id={inputId} {...form.register(field.property)}>
          <option value="">
            {field.required ? "Choose a value" : "Not set"}
          </option>
          <option value="true">True</option>
          <option value="false">False</option>
        </Select>
      </FormField>
    );
  }

  const enumValues = field.schema.enum;
  const initial = model.initialValues[field.property];
  const initialChoices: readonly string[] =
    typeof initial === "string"
      ? initial === ""
        ? []
        : [initial]
      : typeof initial === "boolean"
        ? [String(initial)]
        : (initial ?? []);
  const unavailableChoices = initialChoices.filter(
    (choice) => !enumValues?.some((value) => String(value) === choice),
  );
  if (enumValues !== undefined && field.control === "select") {
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
      >
        <Select id={inputId} {...form.register(field.property)}>
          <option value="">
            {field.required ? "Choose a value" : "Not set"}
          </option>
          {unavailableChoices.map((value) => (
            <option key={value} value={value}>
              Unavailable: {value}
            </option>
          ))}
          {enumValues.map((value) => (
            <option key={String(value)} value={String(value)}>
              {String(value)}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (field.control === "multi-select" && enumValues !== undefined) {
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
      >
        <Select
          id={inputId}
          multiple
          size={Math.min(Math.max(enumValues.length, 2), 6)}
          {...form.register(field.property)}
        >
          {unavailableChoices.map((value) => (
            <option key={value} value={value}>
              Unavailable: {value}
            </option>
          ))}
          {enumValues.map((value) => (
            <option key={String(value)} value={String(value)}>
              {String(value)}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (
    field.control === "textarea" ||
    field.schema.kind === "string-list" ||
    field.schema.kind === "number-list" ||
    field.schema.kind === "integer-list"
  ) {
    return (
      <FormField
        {...validationHighlightAttributes}
        description={description}
        error={error}
        htmlFor={inputId}
        information={information}
        label={field.label}
        required={field.required}
      >
        <Textarea
          className="selected-inspector__textarea"
          id={inputId}
          rows={4}
          {...form.register(field.property)}
        />
      </FormField>
    );
  }

  const numeric =
    field.schema.kind === "number" || field.schema.kind === "integer";
  return (
    <FormField
      {...validationHighlightAttributes}
      description={description}
      error={error}
      htmlFor={inputId}
      information={information}
      label={field.label}
      required={field.required}
    >
      <Input
        id={inputId}
        step={
          field.schema.kind === "integer"
            ? 1
            : field.schema.kind === "number"
              ? "any"
              : undefined
        }
        type={numeric ? "number" : "text"}
        {...form.register(field.property)}
      />
    </FormField>
  );
}

export function AdvancedConfigurationFields({
  disclosureId,
  fields,
  form,
  model,
}: {
  readonly disclosureId: string;
  readonly fields: readonly ConfigurationFormFieldModel[];
  readonly form: ReturnType<typeof useForm<MutableConfigurationFormValues>>;
  readonly model: ReturnType<typeof createConfigurationFormModel>;
}) {
  const [isOpen, setOpen] = useState(false);
  const validationFocus = useEditorSessionState(
    (state) => state.validationFocus,
  );
  const validationLocation = validationFocus?.location;
  const target = model.selected.target;
  const validationProperty =
    validationLocation?.kind === "configuration" &&
    ((target.kind === "node" &&
      validationLocation.owner.kind === "node" &&
      validationLocation.owner.nodeId === target.id) ||
      (target.kind === "edge" &&
        validationLocation.owner.kind === "edge" &&
        validationLocation.owner.edgeId === target.id))
      ? validationLocation.key
      : undefined;

  const containsValidationTarget = fields.some(
    ({ field }) => field.property === validationProperty,
  );
  const values = useWatch({ control: form.control });
  const errorCount = fields.filter(
    ({ field }) =>
      fieldErrorMessage(form.formState.errors, field.property) !== undefined,
  ).length;
  const configuredOrChangedCount = fields.filter(({ field }) => {
    const current = model.currentValues[field.property];
    const initial = model.initialValues[field.property];
    const value = values[field.property];
    const changed =
      Array.isArray(value) && Array.isArray(initial)
        ? value.length !== initial.length ||
          value.some((entry, index) => entry !== initial[index])
        : value !== initial;
    return current !== undefined || changed;
  }).length;

  const summary = [
    `Advanced fields (${String(fields.length)})`,
    configuredOrChangedCount === 0
      ? undefined
      : `${String(configuredOrChangedCount)} configured or changed`,
    errorCount === 0 ? undefined : `${String(errorCount)} with errors`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <Disclosure
      className="selected-inspector__advanced"
      id={disclosureId}
      onToggle={(event) => {
        if (errorCount > 0 && !event.currentTarget.open) {
          event.currentTarget.open = true;
          setOpen(true);
          return;
        }
        setOpen(event.currentTarget.open);
      }}
      open={isOpen || errorCount > 0 || containsValidationTarget}
      summary={summary}
    >
      <div className="selected-inspector__field-group">
        {fields.map((field) => (
          <ConfigurationInput
            fieldModel={field}
            form={form}
            key={field.field.property}
            model={model}
          />
        ))}
      </div>
    </Disclosure>
  );
}
