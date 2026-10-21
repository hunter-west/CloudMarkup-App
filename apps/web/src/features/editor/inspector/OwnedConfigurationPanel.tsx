import type {
  ArchitectureConfiguration,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import {
  Button,
  Disclosure,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from "@cloudmarkup/ui";
import { useMemo, useState, type SyntheticEvent } from "react";

import type {
  EditorCatalogConfigurationField,
  EditorCatalogConfigurationValidationIssue,
  EditorCatalogService,
  EditorOwnedConfigurationSlot,
} from "../model/editor-catalog.js";
import {
  projectOwnedPolicyConfigurations,
  projectOwnedPolicyConfigurationsForEditing,
  type OwnedPolicyGraphDescriptorSet,
  type ProjectedOwnedConfiguration,
  type ProjectedOwnedPolicy,
  type ProjectedPolicyStatement,
} from "../model/owned-configuration-policy-model.js";
import {
  preparePolicyConditionAdd,
  preparePolicyConditionRemove,
  preparePolicyResourceScopeSet,
  policyResourceScopeSetCommandCount,
  preparePolicyStatementAdd,
  preparePolicyStatementDuplicate,
  preparePolicyStatementEdit,
  preparePolicyStatementRemove,
  inspectOwnedConfigurationAssociations,
  prepareUserOwnedConfigurationCreate,
  prepareUserOwnedConfigurationEdit,
  prepareUserOwnedConfigurationRemove,
  prepareUserPolicyCreation,
  prepareUserPolicyRemove,
  type GraphCommandBatchOperationIdentities,
  type StablePolicyNodeIdentity,
} from "../model/owned-policy-commands.js";
import {
  useEditorDocumentSession,
  type EditorDocumentSession,
} from "../session/index.js";
import {
  generatedAdoptionMessage,
  orderOwnedConfigurationSlots,
  ownedConfigurationSectionExplanation,
  ownedConfigurationSectionTitle,
  policyKindPermitsPrincipals,
  statementPrincipalConstraint,
  statementPrincipalHiddenProperties,
  type PolicyKind,
} from "./owned-configuration-panel-model.js";
import type { SelectedNodeInspectorModel } from "./selected-resource-model.js";
import { ConfigurationErrorSummary } from "./configuration-error-summary.js";

import "./owned-configuration-panel.css";

type ReadyEditorSession = Extract<EditorDocumentSession, { status: "ready" }>;
type RawConfigurationValues = Record<string, string>;

function configurationValueText(
  value: Readonly<ConfigurationValue> | undefined,
): string {
  if (value === undefined) {
    return "";
  }
  switch (value.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return String(value.value);
    case "string-list":
    case "number-list":
      return value.value.join("\n");
    case "node-reference":
      return value.nodeId;
    case "variable-reference":
      return value.variableId;
    case "secret-reference":
      return "Configured reference";
  }
}

function rawConfigurationValues(
  service: EditorCatalogService,
  configuration?: ArchitectureConfiguration,
): RawConfigurationValues {
  const defaults =
    service.configuration.defaults.kind === "ready"
      ? service.configuration.defaults.values
      : {};
  const configuredValues = configuration?.values as
    Readonly<Record<string, Readonly<ConfigurationValue>>> | undefined;
  const defaultValues = defaults;
  return Object.fromEntries(
    service.configuration.fields.map((field) => {
      const value =
        configuredValues?.[field.property] ?? defaultValues[field.property];
      const declaredDefault = field.schema.default;
      return [
        field.property,
        value !== undefined
          ? configurationValueText(value)
          : declaredDefault === undefined
            ? ""
            : Array.isArray(declaredDefault)
              ? declaredDefault.join("\n")
              : String(declaredDefault),
      ];
    }),
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function configurationValueFromRaw(
  field: EditorCatalogConfigurationField,
  raw: string,
): Readonly<ConfigurationValue> | undefined {
  const value = raw.trim();
  if (value === "" && !field.required) {
    return undefined;
  }
  switch (field.schema.kind) {
    case "string":
      return { kind: "string", value };
    case "number":
    case "integer":
      return { kind: field.schema.kind, value: Number(value) };
    case "boolean":
      return { kind: "boolean", value: value === "true" };
    case "string-list":
      return { kind: "string-list", value: splitLines(raw) };
    case "number-list":
    case "integer-list":
      return {
        kind: "number-list",
        value: splitLines(raw).map(Number),
      };
  }
}

type ConfigurationBuildResult =
  | { readonly ok: true; readonly configuration: ArchitectureConfiguration }
  | {
      readonly ok: false;
      readonly issues: readonly EditorCatalogConfigurationValidationIssue[];
    };

function buildConfiguration(
  service: EditorCatalogService,
  identity: Pick<ArchitectureConfiguration, "schemaId" | "schemaVersion">,
  rawValues: RawConfigurationValues,
  existing?: ArchitectureConfiguration,
  fixedValues: Readonly<Record<string, string>> = {},
): ConfigurationBuildResult {
  let values: Record<string, Readonly<ConfigurationValue>> = {
    ...(existing?.values ?? {}),
  };
  const inputIssues: EditorCatalogConfigurationValidationIssue[] = [];
  for (const field of service.configuration.fields) {
    if (
      field.valueSource === "node-reference" ||
      field.valueSource === "secret-reference" ||
      field.valueSource === "sensitive-variable-reference"
    ) {
      continue;
    }
    const raw = fixedValues[field.property] ?? rawValues[field.property] ?? "";
    if (
      field.required &&
      raw.trim() === "" &&
      (field.schema.kind === "number" ||
        field.schema.kind === "integer" ||
        field.schema.kind === "boolean")
    ) {
      inputIssues.push({
        code: "missing-required-property",
        property: field.property,
        path: `$.values[${JSON.stringify(field.property)}]`,
        message: `${field.label} is required.`,
      });
      continue;
    }
    if (
      field.schema.kind === "boolean" &&
      raw.trim() !== "" &&
      raw.trim() !== "true" &&
      raw.trim() !== "false"
    ) {
      inputIssues.push({
        code: "invalid-value",
        property: field.property,
        path: `$.values[${JSON.stringify(field.property)}]`,
        message: "Choose true or false.",
      });
      continue;
    }
    const converted = configurationValueFromRaw(field, raw);
    if (converted === undefined) {
      values = Object.fromEntries(
        Object.entries(values).filter(
          ([property]) => property !== field.property,
        ),
      );
    } else {
      values[field.property] = converted;
    }
  }
  const validation = service.configuration.validate(values);
  if (!validation.success) {
    return {
      issues: [
        ...inputIssues,
        ...validation.issues.filter(
          (issue) =>
            !inputIssues.some((input) => input.property === issue.property),
        ),
      ],
      ok: false,
    };
  }
  if (inputIssues.length > 0) return { ok: false, issues: inputIssues };
  return {
    configuration: {
      schemaId: identity.schemaId,
      schemaVersion: identity.schemaVersion,
      values: validation.values,
    },
    ok: true,
  };
}

interface OwnedFormIssue extends EditorCatalogConfigurationValidationIssue {
  readonly fieldId: string | undefined;
  readonly label: string;
}

function ownedFormIssues(
  service: EditorCatalogService,
  idPrefix: string,
  issues: readonly EditorCatalogConfigurationValidationIssue[],
  section?: string,
): readonly OwnedFormIssue[] {
  return issues
    .map((issue) => {
      const field = service.configuration.fields.find(
        (entry) => entry.property === issue.property,
      );
      const label = field?.label ?? "Configuration";
      return {
        ...issue,
        fieldId:
          field === undefined ? undefined : `${idPrefix}-${field.property}`,
        label: section === undefined ? label : `${section}: ${label}`,
      };
    })
    .sort(
      (left, right) =>
        (service.configuration.fields.find(
          (field) => field.property === left.property,
        )?.order ?? Number.MAX_SAFE_INTEGER) -
        (service.configuration.fields.find(
          (field) => field.property === right.property,
        )?.order ?? Number.MAX_SAFE_INTEGER),
    );
}

function commandFormIssue(message: string): OwnedFormIssue {
  return {
    code: "validation-unavailable",
    property: undefined,
    path: "$.command",
    message,
    fieldId: undefined,
    label: "Configuration",
  };
}

function OwnedConfigurationErrors({
  issues,
}: {
  readonly issues: readonly OwnedFormIssue[];
}) {
  const summaryIssues = useMemo(
    () =>
      issues.map((issue) => ({
        key: `${issue.path}:${issue.fieldId ?? issue.code}`,
        label: issue.label,
        message: issue.message,
        fieldId: issue.fieldId,
      })),
    [issues],
  );
  return <ConfigurationErrorSummary issues={summaryIssues} />;
}

function SchemaFields({
  advancedSummary = "Advanced policy fields",
  fixedValues,
  hiddenProperties = [],
  idPrefix,
  issues = [],
  onChange,
  service,
  values,
}: {
  readonly advancedSummary?: string;
  readonly fixedValues: Readonly<Record<string, string>>;
  readonly hiddenProperties?: readonly string[];
  readonly idPrefix: string;
  readonly issues?: readonly OwnedFormIssue[];
  readonly onChange: (property: string, value: string) => void;
  readonly service: EditorCatalogService;
  readonly values: RawConfigurationValues;
}) {
  const renderField = (field: EditorCatalogConfigurationField) => {
    if (hiddenProperties.includes(field.property)) {
      return null;
    }
    const inputId = `${idPrefix}-${field.property}`;
    const error = issues.find((issue) => issue.fieldId === inputId)?.message;
    const value = fixedValues[field.property] ?? values[field.property] ?? "";
    const description =
      field.helpText ??
      (field.schema.kind.endsWith("list")
        ? "Enter one value per line."
        : undefined);
    if (fixedValues[field.property] !== undefined) {
      return (
        <FormField
          description={description}
          error={error}
          htmlFor={inputId}
          key={field.property}
          label={field.label}
          required
        >
          <Input id={inputId} readOnly value={value} />
        </FormField>
      );
    }
    if (field.valueSource === "node-reference") {
      return null;
    }
    const enumValues =
      field.schema.kind === "boolean"
        ? [true, false]
        : "enum" in field.schema
          ? field.schema.enum
          : undefined;
    const control =
      enumValues !== undefined && !field.schema.kind.endsWith("list") ? (
        <Select
          id={inputId}
          onChange={(event) => {
            onChange(field.property, event.target.value);
          }}
          value={value}
        >
          <option value="">
            {field.required ? "Choose a value" : "Not set"}
          </option>
          {value !== "" &&
          !enumValues.some((option) => String(option) === value) ? (
            <option value={value}>Unavailable: {value}</option>
          ) : null}
          {enumValues.map((option) => (
            <option key={String(option)} value={String(option)}>
              {typeof option === "boolean"
                ? option
                  ? "True"
                  : "False"
                : String(option)}
            </option>
          ))}
        </Select>
      ) : field.schema.kind.endsWith("list") ||
        field.control === "textarea" ||
        field.control === "multi-select" ? (
        <Textarea
          id={inputId}
          onChange={(event) => {
            onChange(field.property, event.target.value);
          }}
          rows={4}
          value={value}
        />
      ) : (
        <Input
          id={inputId}
          onChange={(event) => {
            onChange(field.property, event.target.value);
          }}
          value={value}
        />
      );
    return (
      <FormField
        description={description}
        error={error}
        htmlFor={inputId}
        key={field.property}
        label={field.label}
        required={field.required}
        tone={field.securityImpact === "none" ? "default" : "security"}
      >
        {control}
      </FormField>
    );
  };
  const recommended = service.configuration.fields.filter(
    (field) => !field.advanced,
  );
  const advanced = service.configuration.fields.filter(
    (field) => field.advanced,
  );
  return (
    <>
      {recommended.map(renderField)}
      {advanced.length === 0 ? null : (
        <Disclosure summary={advancedSummary}>
          <div className="owned-configuration__form-fields">
            {advanced.map(renderField)}
          </div>
        </Disclosure>
      )}
    </>
  );
}

function StructuredConfigurationForm({
  advancedSummary,
  configuration,
  configurationNodeId,
  fixedValues = {},
  hiddenProperties = [],
  idPrefix,
  onSave,
  service,
  submitLabel,
}: {
  readonly advancedSummary?: string;
  readonly configuration?: ArchitectureConfiguration;
  readonly configurationNodeId?: string;
  readonly fixedValues?: Readonly<Record<string, string>>;
  readonly hiddenProperties?: readonly string[];
  readonly idPrefix: string;
  readonly onSave: (configuration: ArchitectureConfiguration) => {
    readonly message?: string;
    readonly ok: boolean;
  };
  readonly service: EditorCatalogService;
  readonly submitLabel: string;
}) {
  const [values, setValues] = useState(() =>
    rawConfigurationValues(service, configuration),
  );
  const [issues, setIssues] = useState<readonly OwnedFormIssue[]>([]);
  const fieldPrefix =
    configurationNodeId === undefined
      ? idPrefix
      : `inspector-configuration-node-${configurationNodeId}`;
  const identity = configuration ?? {
    schemaId: service.configuration
      .schemaId as ArchitectureConfiguration["schemaId"],
    schemaVersion: service.configuration
      .schemaVersion as ArchitectureConfiguration["schemaVersion"],
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = buildConfiguration(
      service,
      identity,
      values,
      configuration,
      fixedValues,
    );
    if (!built.ok) {
      setIssues(ownedFormIssues(service, fieldPrefix, built.issues));
      return;
    }
    const result = onSave(built.configuration);
    setIssues(
      result.ok
        ? []
        : [commandFormIssue(result.message ?? "The command was rejected.")],
    );
  };
  return (
    <form className="owned-configuration__form" noValidate onSubmit={submit}>
      <SchemaFields
        {...(advancedSummary === undefined ? {} : { advancedSummary })}
        fixedValues={fixedValues}
        hiddenProperties={hiddenProperties}
        idPrefix={fieldPrefix}
        issues={issues}
        onChange={(property, value) => {
          setValues((current) => ({ ...current, [property]: value }));
        }}
        service={service}
        values={values}
      />
      <OwnedConfigurationErrors issues={issues} />
      <Button size="compact" type="submit" variant="primary">
        {submitLabel}
      </Button>
    </form>
  );
}

function operationIdentities(
  session: ReadyEditorSession,
  actionCount: number,
): GraphCommandBatchOperationIdentities {
  const identity = () => ({
    commandId: session.createId(),
    inverseCommandId: session.createId(),
  });
  return {
    actions: Array.from({ length: actionCount }, identity),
    batch: identity(),
  };
}

function stableIdentity(
  session: ReadyEditorSession,
  prefix: string,
  label: string,
  owner: ArchitectureNode,
): StablePolicyNodeIdentity {
  const suffix = session
    .createId()
    .replace(/^operation_editor_/u, "")
    .replaceAll(/[^a-zA-Z0-9_]/gu, "_");
  return {
    deploymentKey: `${prefix}_${suffix}`,
    label,
    nodeId: `node_${prefix}_${suffix}`,
    position: {
      x: owner.presentation.position.x + 16,
      y: owner.presentation.position.y + 16,
    },
  };
}

function stableEdgeId(session: ReadyEditorSession, prefix: string): string {
  const suffix = session
    .createId()
    .replace(/^operation_editor_/u, "")
    .replaceAll(/[^a-zA-Z0-9_]/gu, "_");
  return `edge_${prefix}_${suffix}`;
}

function stringConfigurationValue(
  configuration: ArchitectureConfiguration,
  property: string,
): string | undefined {
  const value = (
    configuration.values as Readonly<
      Record<string, Readonly<ConfigurationValue>>
    >
  )[property];
  return value?.kind === "string" ? value.value : undefined;
}

function lifecycleDetail(node: ArchitectureNode) {
  const { lifecycle } = node.semantic;
  return (
    <p className="owned-configuration__lifecycle">
      Ownership: {lifecycle.ownership}. Origin: {lifecycle.origin}.
      {lifecycle.ownership === "user"
        ? ""
        : ` Provenance: ${lifecycle.provenance.generatorKind} / ${lifecycle.provenance.generatorId} @ ${lifecycle.provenance.generatorVersion}.`}
    </p>
  );
}

export function GeneratedAdoptionPending({
  adoption,
}: {
  readonly adoption: EditorOwnedConfigurationSlot["generatedAdoption"];
}) {
  return (
    <div className="owned-configuration__adoption-pending">
      <StatusBadge
        label={
          adoption === "allowed"
            ? "Adopt before customize"
            : "Generated · read-only"
        }
        tone="read-only"
      />
      <p>{generatedAdoptionMessage(adoption)}</p>
    </div>
  );
}

function managedAttachmentKind(
  slot: EditorOwnedConfigurationSlot,
): "managed-policy-attachment" | "permissions-boundary" | null {
  const kind = slot.policyKinds[0];
  return kind === "managed-policy-attachment" || kind === "permissions-boundary"
    ? kind
    : null;
}

function GenericConfigurationCard({
  configuration,
  descriptors,
  service,
  session,
  slot,
}: {
  readonly configuration: ProjectedOwnedConfiguration;
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly service: EditorCatalogService;
  readonly session: ReadyEditorSession;
  readonly slot: EditorOwnedConfigurationSlot;
}) {
  const node = configuration.configurationNode;
  const title =
    stringConfigurationValue(node.semantic.configuration, "displayName") ??
    stringConfigurationValue(node.semantic.configuration, "policyName") ??
    node.presentation.label;
  if (node.semantic.lifecycle.ownership !== "user") {
    return (
      <article className="owned-configuration__card">
        <h5>{title}</h5>
        <StatusBadge label="Generated · read-only" tone="generated" />
        {lifecycleDetail(node)}
        <GeneratedAdoptionPending adoption={slot.generatedAdoption} />
      </article>
    );
  }
  const attachmentKind = managedAttachmentKind(slot);
  const configurationNoun =
    attachmentKind === null ? "configuration" : "attachment";
  const associationPorts =
    slot.policyKinds.length === 0
      ? service.ports.filter(
          (port) =>
            port.id !== slot.graphBinding.configurationPortId &&
            port.connectionSupport === "supported",
        )
      : [];
  const associationRelationships = session.catalog.relationships ?? [];
  const associations = inspectOwnedConfigurationAssociations({
    associationRelationships,
    configurationNodeId: node.id,
    document: session.document,
    ownerBindingEdgeId: configuration.bindingEdge.id,
  });
  const blockedAssociation = associations.find(
    (association) => association.cleanupKind === "blocked",
  );
  const associationCount = associations.length;
  const associationNoun =
    associationCount === 1 ? "association" : "associations";
  const removeLabel =
    associationCount === 0
      ? `Remove ${configurationNoun}`
      : `Remove ${configurationNoun} and ${String(associationCount)} ${associationNoun}`;
  return (
    <article className="owned-configuration__card">
      <h5>{title}</h5>
      <StatusBadge label="User-owned" tone="info" />
      {lifecycleDetail(node)}
      <Disclosure
        summary={`Current associations (${String(associationCount)})`}
      >
        {associations.length === 0 ? (
          <p>No current associations use this configuration.</p>
        ) : (
          <ul className="owned-configuration__conditions">
            {associations.map((association) => {
              const relationshipLabel =
                association.relationship?.presentationLabel ??
                association.relationship?.displayName ??
                association.edge.semantic.relationshipType;
              const relatedLabel =
                association.relatedNode?.presentation.label ??
                association.relatedNode?.id ??
                "Unavailable resource";
              const cleanupLabel =
                association.cleanupKind === "remove-user-edge"
                  ? "User-owned"
                  : association.cleanupKind === "release-generated-direct-edge"
                    ? "Generated · reviewed cleanup"
                    : "Removal blocked";
              const cleanupTone =
                association.cleanupKind === "remove-user-edge"
                  ? ("info" as const)
                  : association.cleanupKind === "release-generated-direct-edge"
                    ? ("generated" as const)
                    : ("warning" as const);
              const retainedEndpoint =
                association.edge.semantic.source.nodeId === node.id
                  ? ("source" as const)
                  : ("target" as const);
              const replaceableServiceType =
                retainedEndpoint === "source"
                  ? association.relationship?.targetServiceType
                  : association.relationship?.sourceServiceType;
              const replaceableLabel =
                session.catalog.services.find(
                  (candidate) =>
                    candidate.serviceType === replaceableServiceType,
                )?.displayName ?? "associated resource";
              const canRetarget =
                association.cleanupKind === "release-generated-direct-edge";
              return (
                <li key={association.edge.id}>
                  <span>
                    {relationshipLabel} · {relatedLabel}
                  </span>
                  <StatusBadge label={cleanupLabel} tone={cleanupTone} />
                  {association.reason === null ? null : (
                    <span>{association.reason}</span>
                  )}
                  {canRetarget ? (
                    <Button
                      aria-label={`Change ${replaceableLabel} for ${title}`}
                      onClick={() => {
                        session.beginConnection({
                          edgeId: association.edge.id,
                          kind: "edge-retarget",
                          retainedEndpoint,
                        });
                      }}
                      size="compact"
                      type="button"
                      variant="quiet"
                    >
                      Change {replaceableLabel}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Disclosure>
      <p>
        Removing this {configurationNoun} will{" "}
        {associationCount === 0
          ? "remove its owner binding and configuration"
          : `disconnect ${String(associationCount)} current ${associationNoun}, remove its owner binding, and remove the configuration`}{" "}
        in one undoable change. Generated direct associations are released only
        through their exact reviewed lifecycle; shared, supporting, adopted, or
        unrecognized resources block removal.
      </p>
      {blockedAssociation === undefined ? null : (
        <p role="status">Removal is unavailable. {blockedAssociation.reason}</p>
      )}
      <Disclosure summary={`Edit ${configurationNoun}`}>
        <StructuredConfigurationForm
          advancedSummary={
            attachmentKind === null
              ? "Advanced configuration fields"
              : "Advanced policy fields"
          }
          configuration={node.semantic.configuration}
          configurationNodeId={node.id}
          fixedValues={attachmentKind === null ? {} : { attachmentKind }}
          idPrefix={`owned-edit-${node.id}`}
          onSave={(nextConfiguration) =>
            session.applyOwnedPolicyCommand(
              prepareUserOwnedConfigurationEdit({
                configuration: nextConfiguration,
                configurationNodeId: node.id,
                descriptors,
                document: session.document,
                operationIdentities: operationIdentities(session, 1),
              }),
              `Update ${ownedConfigurationSectionTitle(slot)}`,
            )
          }
          service={service}
          submitLabel={`Save ${configurationNoun}`}
        />
      </Disclosure>
      {associationPorts.length === 0 ? null : (
        <div
          aria-label={`${title} associations`}
          className="owned-configuration__actions"
          role="group"
        >
          {associationPorts.map((port) => (
            <Button
              aria-label={`Choose ${port.displayName} for ${title}`}
              key={port.id}
              onClick={() => {
                session.beginConnection({
                  direction: port.direction,
                  kind: "port",
                  nodeId: node.id,
                  portId: port.id,
                });
              }}
              size="compact"
              type="button"
              variant="quiet"
            >
              Choose {port.displayName}
            </Button>
          ))}
        </div>
      )}
      <Button
        disabled={blockedAssociation !== undefined}
        onClick={() =>
          session.applyOwnedPolicyCommand(
            prepareUserOwnedConfigurationRemove({
              associationRelationships,
              configurationNodeId: node.id,
              descriptors,
              document: session.document,
              operationIdentities: operationIdentities(
                session,
                associationCount + 2,
              ),
            }),
            `Remove ${ownedConfigurationSectionTitle(slot)}`,
          )
        }
        size="compact"
        type="button"
        variant="quiet"
      >
        {removeLabel}
      </Button>
    </article>
  );
}

function ConditionList({
  descriptors,
  policy,
  session,
  statement,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly policy: ProjectedOwnedPolicy;
  readonly session: ReadyEditorSession;
  readonly statement: ProjectedPolicyStatement;
}) {
  const conditionService = session.catalog.services.find(
    (service) => service.serviceType === descriptors.conditionKind.serviceType,
  );
  if (conditionService === undefined) {
    return null;
  }
  return (
    <Disclosure summary={`Conditions (${String(statement.conditions.length)})`}>
      <ul className="owned-configuration__conditions">
        {statement.conditions.map((condition) => (
          <li key={condition.node.id}>
            <span>
              {stringConfigurationValue(
                condition.node.semantic.configuration,
                "operator",
              ) ?? "Condition"}{" "}
              ·{` `}
              {stringConfigurationValue(
                condition.node.semantic.configuration,
                "key",
              ) ?? condition.node.presentation.label}
            </span>
            <Button
              onClick={() =>
                session.applyOwnedPolicyCommand(
                  preparePolicyConditionRemove({
                    conditionNodeId: condition.node.id,
                    descriptors,
                    document: session.document,
                    operationIdentities: operationIdentities(session, 2),
                    policyNodeId: policy.configurationNode.id,
                    statementNodeId: statement.node.id,
                  }),
                  "Remove policy condition",
                )
              }
              size="compact"
              type="button"
              variant="quiet"
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <StructuredConfigurationForm
        idPrefix={`condition-add-${statement.node.id}`}
        onSave={(configuration) => {
          const identity = stableIdentity(
            session,
            "policy_condition",
            "Policy condition",
            policy.configurationNode,
          );
          return session.applyOwnedPolicyCommand(
            preparePolicyConditionAdd({
              condition: { ...identity, configuration },
              descriptors,
              document: session.document,
              membershipEdgeId: stableEdgeId(session, "policy_condition"),
              operationIdentities: operationIdentities(session, 2),
              policyNodeId: policy.configurationNode.id,
              statementNodeId: statement.node.id,
            }),
            "Add policy condition",
          );
        }}
        service={conditionService}
        submitLabel="Add condition"
      />
    </Disclosure>
  );
}

function ResourceScopeControl({
  descriptors,
  policy,
  session,
  statement,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly policy: ProjectedOwnedPolicy;
  readonly session: ReadyEditorSession;
  readonly statement: ProjectedPolicyStatement;
}) {
  const options = descriptors.resourceScopes.flatMap((descriptor) =>
    session.document.nodes
      .filter(
        (node) =>
          node.semantic.serviceType === descriptor.resourceServiceType &&
          node.semantic.resourceType === descriptor.resourceResourceType,
      )
      .map((node) => ({ descriptor, node })),
  );
  const current = statement.resourceScopes[0];
  const [selection, setSelection] = useState(() =>
    current === undefined
      ? ""
      : `${current.descriptorId}\u0000${current.resourceNodeId}`,
  );
  if (options.length === 0) {
    return (
      <p>No compatible graph resources are available for this statement.</p>
    );
  }
  return (
    <div className="owned-configuration__scope">
      <FormField
        description="Prefer a resource already in this Architecture Document. The exact graph reference is preserved."
        htmlFor={`policy-resource-${statement.node.id}`}
        label="Architecture resource"
      >
        <Select
          id={`policy-resource-${statement.node.id}`}
          onChange={(event) => {
            setSelection(event.target.value);
          }}
          value={selection}
        >
          <option value="">Choose a resource</option>
          {options.map(({ descriptor, node }) => (
            <option
              key={`${descriptor.id}:${node.id}`}
              value={`${descriptor.id}\u0000${node.id}`}
            >
              {node.presentation.label}
            </option>
          ))}
        </Select>
      </FormField>
      <Button
        disabled={selection === ""}
        onClick={() => {
          const [descriptorId, resourceNodeId] = selection.split("\u0000");
          if (descriptorId === undefined || resourceNodeId === undefined) {
            return;
          }
          const descriptor = descriptors.resourceScopes.find(
            (entry) => entry.id === descriptorId,
          );
          if (descriptor === undefined) return;
          const scopeEdgeId =
            current?.edge.id ?? stableEdgeId(session, "policy_resource_scope");
          session.applyOwnedPolicyCommand(
            preparePolicyResourceScopeSet({
              descriptors,
              document: session.document,
              operationIdentities: operationIdentities(
                session,
                policyResourceScopeSetCommandCount({
                  statement,
                  descriptor,
                  resourceNodeId,
                  scopeEdgeId,
                }),
              ),
              policyNodeId: policy.configurationNode.id,
              resourceNodeId,
              resourceScopeDescriptorId: descriptorId,
              scopeEdgeId,
              statementNodeId: statement.node.id,
            }),
            "Set policy resource scope",
          );
        }}
        size="compact"
        type="button"
      >
        Set resource scope
      </Button>
    </div>
  );
}

function StatementEditor({
  descriptors,
  policy,
  policyKind,
  service,
  session,
  statement,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly policy: ProjectedOwnedPolicy;
  readonly policyKind: PolicyKind;
  readonly service: EditorCatalogService;
  readonly session: ReadyEditorSession;
  readonly statement: ProjectedPolicyStatement;
}) {
  const title =
    stringConfigurationValue(
      statement.node.semantic.configuration,
      "statementId",
    ) ?? statement.node.presentation.label;
  const generated =
    policy.configurationNode.semantic.lifecycle.ownership === "generated" ||
    statement.node.semantic.lifecycle.ownership === "generated";
  const principalConstraint = statementPrincipalConstraint(policyKind);
  const hiddenPrincipalFields = statementPrincipalHiddenProperties(policyKind);
  return (
    <Disclosure summary={title}>
      {generated ? (
        <p>
          This generated statement is read-only until its policy is adopted.
        </p>
      ) : (
        <>
          <StructuredConfigurationForm
            configuration={statement.node.semantic.configuration}
            configurationNodeId={statement.node.id}
            fixedValues={principalConstraint}
            hiddenProperties={hiddenPrincipalFields}
            idPrefix={`statement-edit-${statement.node.id}`}
            onSave={(configuration) =>
              session.applyOwnedPolicyCommand(
                preparePolicyStatementEdit({
                  configuration,
                  descriptors,
                  document: session.document,
                  operationIdentities: operationIdentities(session, 1),
                  policyNodeId: policy.configurationNode.id,
                  statementNodeId: statement.node.id,
                }),
                "Update policy statement",
              )
            }
            service={service}
            submitLabel="Save statement"
          />
          {policyKindPermitsPrincipals(policyKind) ? null : (
            <p>Principals are not permitted for this policy kind.</p>
          )}
          <ResourceScopeControl
            descriptors={descriptors}
            policy={policy}
            session={session}
            statement={statement}
          />
          <ConditionList
            descriptors={descriptors}
            policy={policy}
            session={session}
            statement={statement}
          />
          <div className="owned-configuration__actions">
            <Button
              onClick={() => {
                const duplicate = stableIdentity(
                  session,
                  "policy_statement",
                  `${title} copy`,
                  policy.configurationNode,
                );
                const conditions = statement.conditions.map((condition) => ({
                  duplicateCondition: stableIdentity(
                    session,
                    "policy_condition",
                    `${condition.node.presentation.label} copy`,
                    policy.configurationNode,
                  ),
                  membershipEdgeId: stableEdgeId(session, "policy_condition"),
                  sourceConditionNodeId: condition.node.id,
                }));
                const resourceScopes = statement.resourceScopes.map(
                  (scope) => ({
                    duplicateScopeEdgeId: stableEdgeId(
                      session,
                      "policy_resource_scope",
                    ),
                    sourceScopeEdgeId: scope.edge.id,
                  }),
                );
                session.applyOwnedPolicyCommand(
                  preparePolicyStatementDuplicate({
                    conditions,
                    descriptors,
                    document: session.document,
                    duplicateStatement: duplicate,
                    membershipEdgeId: stableEdgeId(session, "policy_statement"),
                    operationIdentities: operationIdentities(
                      session,
                      2 + conditions.length * 2 + resourceScopes.length,
                    ),
                    policyNodeId: policy.configurationNode.id,
                    resourceScopes,
                    statementNodeId: statement.node.id,
                  }),
                  "Duplicate policy statement",
                );
              }}
              size="compact"
              type="button"
            >
              Duplicate statement
            </Button>
            <Button
              onClick={() =>
                session.applyOwnedPolicyCommand(
                  preparePolicyStatementRemove({
                    descriptors,
                    document: session.document,
                    operationIdentities: operationIdentities(
                      session,
                      2 +
                        statement.conditions.length * 2 +
                        statement.resourceScopes.length,
                    ),
                    policyNodeId: policy.configurationNode.id,
                    statementNodeId: statement.node.id,
                  }),
                  "Remove policy statement",
                )
              }
              size="compact"
              type="button"
              variant="quiet"
            >
              Remove statement
            </Button>
          </div>
        </>
      )}
    </Disclosure>
  );
}

function PolicyCard({
  descriptors,
  policy,
  session,
  slot,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly policy: ProjectedOwnedPolicy;
  readonly session: ReadyEditorSession;
  readonly slot: EditorOwnedConfigurationSlot;
}) {
  const policyService = session.catalog.services.find(
    (service) =>
      service.serviceType === policy.configurationNode.semantic.serviceType,
  );
  const statementService = session.catalog.services.find(
    (service) => service.serviceType === descriptors.statementKind.serviceType,
  );
  if (policyService === undefined || statementService === undefined) {
    return null;
  }
  const node = policy.configurationNode;
  const title =
    stringConfigurationValue(node.semantic.configuration, "policyName") ??
    node.presentation.label;
  const generated = node.semantic.lifecycle.ownership === "generated";
  const conditionCount = policy.statements.reduce(
    (count, statement) => count + statement.conditions.length,
    0,
  );
  const scopeCount = policy.statements.reduce(
    (count, statement) => count + statement.resourceScopes.length,
    0,
  );
  return (
    <article className="owned-configuration__card">
      <div className="owned-configuration__card-heading">
        <h5>{title}</h5>
        <StatusBadge
          label={generated ? "Generated · read-only" : "User-owned"}
          tone={generated ? "generated" : "info"}
        />
      </div>
      {lifecycleDetail(node)}
      <p>{String(policy.statements.length)} structured statement(s).</p>
      {generated ? (
        <GeneratedAdoptionPending adoption={slot.generatedAdoption} />
      ) : (
        <>
          <Disclosure summary="Edit policy details">
            <StructuredConfigurationForm
              configuration={node.semantic.configuration}
              configurationNodeId={node.id}
              fixedValues={{
                policyKind: slot.policyKinds[0] ?? "identity-inline",
              }}
              idPrefix={`policy-edit-${node.id}`}
              onSave={(configuration) =>
                session.applyOwnedPolicyCommand(
                  prepareUserOwnedConfigurationEdit({
                    configuration,
                    configurationNodeId: node.id,
                    descriptors,
                    document: session.document,
                    operationIdentities: operationIdentities(session, 1),
                  }),
                  "Update policy details",
                )
              }
              service={policyService}
              submitLabel="Save policy details"
            />
          </Disclosure>
          {policy.statements.map((statement) => (
            <StatementEditor
              descriptors={descriptors}
              key={statement.node.id}
              policy={policy}
              policyKind={slot.policyKinds[0] ?? "identity-inline"}
              service={statementService}
              session={session}
              statement={statement}
            />
          ))}
          <Disclosure summary="Add statement">
            <StructuredConfigurationForm
              fixedValues={statementPrincipalConstraint(
                slot.policyKinds[0] ?? "identity-inline",
              )}
              hiddenProperties={statementPrincipalHiddenProperties(
                slot.policyKinds[0] ?? "identity-inline",
              )}
              idPrefix={`statement-add-${node.id}`}
              onSave={(configuration) => {
                const identity = stableIdentity(
                  session,
                  "policy_statement",
                  "Policy statement",
                  node,
                );
                return session.applyOwnedPolicyCommand(
                  preparePolicyStatementAdd({
                    descriptors,
                    document: session.document,
                    membershipEdgeId: stableEdgeId(session, "policy_statement"),
                    operationIdentities: operationIdentities(session, 2),
                    policyNodeId: node.id,
                    statement: { ...identity, configuration },
                  }),
                  "Add policy statement",
                );
              }}
              service={statementService}
              submitLabel="Add statement"
            />
          </Disclosure>
          <Button
            onClick={() =>
              session.applyOwnedPolicyCommand(
                prepareUserPolicyRemove({
                  descriptors,
                  document: session.document,
                  operationIdentities: operationIdentities(
                    session,
                    2 +
                      policy.statements.length * 2 +
                      conditionCount * 2 +
                      scopeCount,
                  ),
                  policyNodeId: node.id,
                }),
                "Remove custom policy",
              )
            }
            size="compact"
            type="button"
            variant="quiet"
          >
            Remove policy
          </Button>
        </>
      )}
    </article>
  );
}

function PolicyCreationForm({
  descriptors,
  owner,
  policyService,
  session,
  slot,
  statementService,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly owner: ArchitectureNode;
  readonly policyService: EditorCatalogService;
  readonly session: ReadyEditorSession;
  readonly slot: EditorOwnedConfigurationSlot;
  readonly statementService: EditorCatalogService;
}) {
  const policyKind = slot.policyKinds[0] ?? "identity-inline";
  const principalConstraint = statementPrincipalConstraint(policyKind);
  const [policyValues, setPolicyValues] = useState(() =>
    rawConfigurationValues(policyService),
  );
  const [statementValues, setStatementValues] = useState(() =>
    rawConfigurationValues(statementService),
  );
  const [issues, setIssues] = useState<readonly OwnedFormIssue[]>([]);
  const policyPrefix = `policy-create-${slot.id}`;
  const statementPrefix = `statement-create-${slot.id}`;
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const policyKindDescriptor = descriptors.ownedConfigurations.kinds.find(
      (kind) => kind.id === slot.graphBinding.configurationServiceType,
    );
    if (policyKindDescriptor === undefined) {
      setIssues([
        commandFormIssue("The exact graph-backed policy kind is unavailable."),
      ]);
      return;
    }
    const policyConfiguration = buildConfiguration(
      policyService,
      {
        schemaId: policyKindDescriptor.configurationSchemaId,
        schemaVersion: policyKindDescriptor.configurationSchemaVersion,
      },
      policyValues,
      undefined,
      { policyKind },
    );
    const statementConfiguration = buildConfiguration(
      statementService,
      {
        schemaId: descriptors.statementKind.configurationSchemaId,
        schemaVersion: descriptors.statementKind.configurationSchemaVersion,
      },
      statementValues,
    );
    if (!policyConfiguration.ok || !statementConfiguration.ok) {
      setIssues([
        ...(policyConfiguration.ok
          ? []
          : ownedFormIssues(
              policyService,
              policyPrefix,
              policyConfiguration.issues,
              "Policy details",
            )),
        ...(statementConfiguration.ok
          ? []
          : ownedFormIssues(
              statementService,
              statementPrefix,
              statementConfiguration.issues,
              "Initial statement",
            )),
      ]);
      return;
    }
    const policyName =
      stringConfigurationValue(
        policyConfiguration.configuration,
        "policyName",
      ) ?? ownedConfigurationSectionTitle(slot);
    const policyIdentity = stableIdentity(
      session,
      "policy_document",
      policyName,
      owner,
    );
    const statementIdentity = stableIdentity(
      session,
      "policy_statement",
      "Policy statement",
      owner,
    );
    const result = session.applyOwnedPolicyCommand(
      prepareUserPolicyCreation({
        descriptors,
        document: session.document,
        initialStatement: {
          ...statementIdentity,
          configuration: statementConfiguration.configuration,
        },
        operationIdentities: operationIdentities(session, 4),
        ownerBindingEdgeId: stableEdgeId(session, "policy_owner"),
        ownerNodeId: owner.id,
        policy: {
          ...policyIdentity,
          configuration: policyConfiguration.configuration,
        },
        policyOwnedKindId: slot.graphBinding.configurationServiceType,
        slotId: slot.id,
        statementMembershipEdgeId: stableEdgeId(session, "policy_statement"),
      }),
      `Add ${ownedConfigurationSectionTitle(slot)}`,
    );
    setIssues(result.ok ? [] : [commandFormIssue(result.message)]);
  };
  return (
    <form className="owned-configuration__form" noValidate onSubmit={submit}>
      <h5>Policy details</h5>
      <SchemaFields
        fixedValues={{ policyKind }}
        idPrefix={policyPrefix}
        issues={issues}
        onChange={(property, value) => {
          setPolicyValues((current) => ({ ...current, [property]: value }));
        }}
        service={policyService}
        values={policyValues}
      />
      <h5>Initial statement</h5>
      {policyKindPermitsPrincipals(policyKind) ? null : (
        <p>Principals are not permitted for this policy kind.</p>
      )}
      <SchemaFields
        fixedValues={principalConstraint}
        hiddenProperties={statementPrincipalHiddenProperties(policyKind)}
        idPrefix={statementPrefix}
        issues={issues}
        onChange={(property, value) => {
          setStatementValues((current) => ({ ...current, [property]: value }));
        }}
        service={statementService}
        values={statementValues}
      />
      <OwnedConfigurationErrors issues={issues} />
      <Button size="compact" type="submit" variant="primary">
        Add policy
      </Button>
    </form>
  );
}

function CreateOwnedConfiguration({
  descriptors,
  owner,
  session,
  slot,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly owner: ArchitectureNode;
  readonly session: ReadyEditorSession;
  readonly slot: EditorOwnedConfigurationSlot;
}) {
  const service = session.catalog.services.find(
    (candidate) =>
      candidate.serviceType === slot.graphBinding.configurationServiceType,
  );
  if (service === undefined) {
    return null;
  }
  const policyKind = slot.policyKinds[0];
  const attachmentKind = managedAttachmentKind(slot);
  if (policyKind !== undefined && attachmentKind === null) {
    const statementService = session.catalog.services.find(
      (candidate) =>
        candidate.serviceType === descriptors.statementKind.serviceType,
    );
    return statementService === undefined ? null : (
      <PolicyCreationForm
        descriptors={descriptors}
        owner={owner}
        policyService={service}
        session={session}
        slot={slot}
        statementService={statementService}
      />
    );
  }
  const kind = descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === slot.graphBinding.configurationServiceType,
  );
  if (kind === undefined) {
    return null;
  }
  return (
    <StructuredConfigurationForm
      advancedSummary={
        attachmentKind === null
          ? "Advanced configuration fields"
          : "Advanced policy fields"
      }
      fixedValues={attachmentKind === null ? {} : { attachmentKind }}
      idPrefix={`owned-create-${slot.id}`}
      onSave={(configuration) => {
        const label =
          stringConfigurationValue(configuration, "displayName") ??
          ownedConfigurationSectionTitle(slot);
        const identity = stableIdentity(
          session,
          attachmentKind === null
            ? "owned_configuration"
            : "managed_attachment",
          label,
          owner,
        );
        return session.applyOwnedPolicyCommand(
          prepareUserOwnedConfigurationCreate({
            descriptors,
            document: session.document,
            operationIdentities: operationIdentities(session, 2),
            ownedConfiguration: { ...identity, configuration },
            ownedKindId: kind.id,
            ownerBindingEdgeId: stableEdgeId(
              session,
              attachmentKind === null
                ? "owned_configuration"
                : "managed_attachment",
            ),
            ownerNodeId: owner.id,
            slotId: slot.id,
          }),
          `Add ${ownedConfigurationSectionTitle(slot)}`,
        );
      }}
      service={service}
      submitLabel={`Add ${ownedConfigurationSectionTitle(slot).toLowerCase()}`}
    />
  );
}

function OwnedConfigurationSection({
  configurations,
  descriptors,
  owner,
  policies,
  projectionValid,
  session,
  slot,
}: {
  readonly configurations: readonly ProjectedOwnedConfiguration[];
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly owner: ArchitectureNode;
  readonly policies: ReadonlyMap<string, ProjectedOwnedPolicy>;
  readonly projectionValid: boolean;
  readonly session: ReadyEditorSession;
  readonly slot: EditorOwnedConfigurationSlot;
}) {
  const service = session.catalog.services.find(
    (candidate) =>
      candidate.serviceType === slot.graphBinding.configurationServiceType,
  );
  const maximumReached =
    slot.cardinality.maximum !== "many" &&
    configurations.length >= slot.cardinality.maximum;
  const canCreate =
    projectionValid &&
    slot.allowedOwnership.includes("user") &&
    !maximumReached;
  return (
    <section
      className="owned-configuration__section"
      data-owned-configuration-slot={slot.id}
    >
      <div className="owned-configuration__section-heading">
        <div>
          <h4>{ownedConfigurationSectionTitle(slot)}</h4>
          <p>{ownedConfigurationSectionExplanation(slot)}</p>
        </div>
        <StatusBadge
          label={`${String(configurations.length)} configured`}
          tone={
            configurations.length < slot.cardinality.minimum
              ? "warning"
              : "neutral"
          }
        />
      </div>
      <div className="owned-configuration__cards">
        {configurations.map((configuration) => {
          const policy = policies.get(configuration.configurationNode.id);
          return policy === undefined ? (
            service === undefined ? null : (
              <GenericConfigurationCard
                configuration={configuration}
                descriptors={descriptors}
                key={configuration.configurationNode.id}
                service={service}
                session={session}
                slot={slot}
              />
            )
          ) : (
            <PolicyCard
              descriptors={descriptors}
              key={configuration.configurationNode.id}
              policy={policy}
              session={session}
              slot={slot}
            />
          );
        })}
      </div>
      {canCreate ? (
        <Disclosure summary={`Add ${ownedConfigurationSectionTitle(slot)}`}>
          <CreateOwnedConfiguration
            descriptors={descriptors}
            owner={owner}
            session={session}
            slot={slot}
          />
        </Disclosure>
      ) : maximumReached ? (
        <p>The provider rule already permits the maximum for this slot.</p>
      ) : null}
    </section>
  );
}

function ReadyOwnedConfigurationPanel({
  descriptors,
  model,
  session,
}: {
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly model: SelectedNodeInspectorModel;
  readonly session: ReadyEditorSession;
}) {
  const projection = useMemo(
    () => projectOwnedPolicyConfigurations(session.document, descriptors),
    [descriptors, session.document],
  );
  const editingProjection = useMemo(
    () =>
      projection.success
        ? projection
        : projectOwnedPolicyConfigurationsForEditing(
            session.document,
            descriptors,
          ),
    [descriptors, projection, session.document],
  );
  const slots = orderOwnedConfigurationSlots(
    model.service.ownedConfigurationSlots ?? [],
  );
  const configurations = editingProjection.configurations.filter(
    (configuration) => configuration.ownerNodeId === model.node.id,
  );
  const policies = new Map(
    editingProjection.policies
      .filter((policy) => policy.ownerNodeId === model.node.id)
      .map((policy) => [policy.configurationNode.id, policy]),
  );
  return (
    <section aria-label="Owned configurations" className="owned-configuration">
      {projection.success ? null : editingProjection.success ? (
        <p role="status">
          Required settings are incomplete. Add the missing settings to finish
          configuration.
        </p>
      ) : (
        <div className="owned-configuration__projection-error" role="alert">
          <strong>Some policy details need repair before editing.</strong>
          <p>
            Review the related finding in Issues. If a generated connection
            created this permission, open that connection’s Manage action to
            remove it and reconnect with the current catalog.
          </p>
          <details>
            <summary>Technical details</summary>
            <ul>
              {projection.findings.map((finding) => (
                <li key={`${finding.path}:${finding.code}`}>
                  {finding.message} ({finding.path})
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <Disclosure
        className="owned-configuration__disclosure"
        open
        summary={`Policies and related settings (${String(configurations.length)})`}
      >
        {slots.map((slot) => (
          <OwnedConfigurationSection
            configurations={configurations.filter(
              (configuration) => configuration.slotId === slot.id,
            )}
            descriptors={descriptors}
            key={slot.id}
            owner={model.node}
            policies={policies}
            projectionValid={editingProjection.success}
            session={session}
            slot={slot}
          />
        ))}
      </Disclosure>
    </section>
  );
}

export function OwnedConfigurationPanel({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const editorSession = useEditorDocumentSession();
  const descriptors = editorSession.ownedPolicyDescriptors;
  if (
    editorSession.status !== "ready" ||
    descriptors === null ||
    (model.service.ownedConfigurationSlots?.length ?? 0) === 0
  ) {
    return null;
  }
  return (
    <ReadyOwnedConfigurationPanel
      descriptors={descriptors}
      model={model}
      session={editorSession}
    />
  );
}
