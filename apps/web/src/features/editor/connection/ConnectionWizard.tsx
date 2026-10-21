import { graphChangeResourceLabel } from "../model/graph-change-resource-label.js";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import {
  Button,
  Checkbox,
  Dialog,
  FormField,
  Input,
  RadioGroup,
  Select,
  StatusBadge,
  Textarea,
} from "@cloudmarkup/ui";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleDollarSign,
  Cloud,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useModePreference } from "../../../preferences/index.js";
import { AppLink } from "../../../routing/index.js";
import {
  EDITOR_CONNECTION_CATEGORY_ORDER,
  connectionConfigurationValueText,
  editorConnectionCategoryLabel,
  type EditorCatalogConfigurationField,
  type EditorCatalogEducation,
  type EditorConnectionCandidate,
  type EditorConnectionFinding,
  type EditorConnectionPreview,
} from "../model/index.js";
import { useEditorDocumentSession } from "../session/index.js";
import { eventDeliveryGuidance } from "./event-delivery-guidance.js";
import { ConfigurationErrorSummary } from "../inspector/configuration-error-summary.js";

function findingMatchesProperty(
  finding: EditorConnectionFinding,
  property: string,
): boolean {
  return finding.path
    .replaceAll("[", ".")
    .replaceAll("]", "")
    .split(".")
    .some(
      (part) =>
        part === property ||
        part === JSON.stringify(property) ||
        part === `'${property}'`,
    );
}

function selectedCandidate(
  candidates: readonly EditorConnectionCandidate[],
  key: string | null,
): EditorConnectionCandidate | undefined {
  return candidates.find((candidate) => candidate.key === key);
}

function literalValue(
  value: Readonly<ConfigurationValue> | undefined,
):
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | undefined {
  if (value === undefined || !("value" in value)) {
    return undefined;
  }
  return value.value;
}

function Findings({
  findings,
}: {
  readonly findings: readonly EditorConnectionFinding[];
}) {
  const { mode } = useModePreference();
  if (findings.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Connection findings"
      className="connection-wizard__findings"
    >
      {findings.map((finding) => (
        <li
          data-severity={finding.severity}
          key={`${finding.code}:${finding.path}`}
        >
          <StatusBadge
            label={finding.severity === "error" ? "Error" : "Warning"}
            tone={finding.severity === "error" ? "error" : "warning"}
          />
          <span>
            <strong>
              {mode === "guided"
                ? finding.guidedMessage
                : finding.professionalMessage}
            </strong>
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ValidatedEducationTarget {
  readonly external: boolean;
  readonly href: string;
  readonly title: string;
}

const FALLBACK_EDUCATION_TARGET: ValidatedEducationTarget = {
  external: false,
  href: "/help/connections",
  title: "Connection guidance",
};

function isValidatedHttpsHref(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function validatedEducationTarget(
  education: EditorCatalogEducation | null | undefined,
): ValidatedEducationTarget {
  for (const reference of education?.documentation ?? []) {
    if (reference.kind === "official") {
      if (isValidatedHttpsHref(reference.href)) {
        return {
          external: true,
          href: reference.href,
          title: reference.title,
        };
      }
      continue;
    }
  }

  return FALLBACK_EDUCATION_TARGET;
}

function EducationLink({
  education,
}: {
  readonly education: EditorCatalogEducation | null | undefined;
}) {
  const target = validatedEducationTarget(education);
  const label = "Read the deeper provider guidance";
  if (target.external) {
    return (
      <a
        href={target.href}
        rel="noreferrer"
        target="_blank"
        title={target.title}
      >
        {label}
      </a>
    );
  }
  return (
    <AppLink to={target.href} title={target.title}>
      {label}
    </AppLink>
  );
}

function updateStringValue(
  field: EditorCatalogConfigurationField,
  raw: string,
): Readonly<ConfigurationValue> | undefined {
  if (raw === "" && !field.required) {
    return undefined;
  }
  switch (field.schema.kind) {
    case "string":
      return { kind: "string", value: raw };
    case "number":
    case "integer": {
      const value = Number(raw);
      return raw.trim() === "" || !Number.isFinite(value)
        ? undefined
        : { kind: field.schema.kind, value };
    }
    case "boolean":
      return raw === ""
        ? undefined
        : { kind: "boolean", value: raw === "true" };
    case "string-list":
      return {
        kind: "string-list",
        value: raw
          .split(/\r?\n/u)
          .map((item) => item.trim())
          .filter(Boolean),
      };
    case "number-list":
    case "integer-list":
      return {
        kind: "number-list",
        value: raw
          .split(/\r?\n/u)
          .map((item) => Number(item.trim()))
          .filter(Number.isFinite),
      };
  }
}

function ConfigurationControl({
  candidate,
  field,
  finding,
  mode,
  onChange,
  value,
}: {
  readonly candidate: EditorConnectionCandidate;
  readonly field: EditorCatalogConfigurationField;
  readonly finding: EditorConnectionFinding | undefined;
  readonly mode: "guided" | "professional";
  readonly onChange: (value: Readonly<ConfigurationValue> | undefined) => void;
  readonly value: Readonly<ConfigurationValue> | undefined;
}) {
  const question = candidate.relationship.questions.find(
    (item) => item.property === field.property,
  );
  const inputId = `connection-${candidate.relationship.descriptorId}-${field.property}`;
  const recommendation =
    question?.answer.kind === "required-user-input"
      ? question.answer.reason
      : question?.answer.kind === "catalog-default"
        ? mode === "guided"
          ? "The reviewed catalog default is recommended."
          : "Recommended catalog default."
        : undefined;
  const explanation = [
    ...new Set(
      [question?.explanation, field.helpText, recommendation].filter(Boolean),
    ),
  ].join(" ");
  const current = literalValue(value);
  const label = question?.prompt ?? field.label;
  const requiresUserDecision =
    question?.answer.kind === "required-user-input" ||
    (question?.answer.kind !== "catalog-default" && field.required);
  const required = field.required || requiresUserDecision;
  const decisionLabel = (
    <>
      {label}{" "}
      <span className="cm-form-field__required">
        {required ? "Required" : "Optional"}
      </span>
    </>
  );
  const findingMessage =
    mode === "guided" ? finding?.guidedMessage : finding?.professionalMessage;

  if (field.valueSource !== "literal") {
    return (
      <FormField
        description={`${explanation} This value must come from a supported reference and cannot be selected here.`}
        error={findingMessage}
        htmlFor={inputId}
        label={label}
        required={required}
      >
        <Input disabled id={inputId} value="" />
      </FormField>
    );
  }

  if (field.schema.kind === "boolean" && field.control === "checkbox") {
    const errorId = `${inputId}-error`;
    return (
      <div className="connection-wizard__field">
        <Checkbox
          aria-describedby={finding === undefined ? undefined : errorId}
          aria-invalid={finding === undefined ? undefined : true}
          checked={current === true}
          description={explanation}
          inputId={inputId}
          label={decisionLabel}
          onChange={(event) => {
            onChange({ kind: "boolean", value: event.currentTarget.checked });
          }}
        />
        {finding === undefined ? null : (
          <p className="cm-form-field__error" id={errorId}>
            {findingMessage}
          </p>
        )}
      </div>
    );
  }

  const enumValues = "enum" in field.schema ? field.schema.enum : undefined;
  if (field.control === "select" || enumValues !== undefined) {
    const selectedValue = current === undefined ? "" : String(current);
    const unavailable =
      selectedValue !== "" &&
      !enumValues?.some((item) => String(item) === selectedValue);
    return (
      <FormField
        description={explanation}
        error={findingMessage}
        htmlFor={inputId}
        label={label}
        required={required}
        tone={
          field.securityImpact === "none"
            ? field.costImpact === "cost-sensitive"
              ? "warning"
              : "default"
            : "security"
        }
      >
        <Select
          id={inputId}
          onChange={(event) => {
            onChange(updateStringValue(field, event.currentTarget.value));
          }}
          value={selectedValue}
        >
          <option value="">{required ? "Choose a value" : "Not set"}</option>
          {unavailable ? (
            <option value={selectedValue}>Unavailable: {selectedValue}</option>
          ) : null}
          {enumValues?.map((item) => (
            <option key={String(item)} value={String(item)}>
              {String(item)}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (
    field.schema.kind === "string-list" ||
    field.schema.kind === "number-list" ||
    field.schema.kind === "integer-list"
  ) {
    return (
      <FormField
        description={explanation}
        error={findingMessage}
        htmlFor={inputId}
        label={label}
        required={required}
      >
        <Textarea
          id={inputId}
          onChange={(event) => {
            onChange(updateStringValue(field, event.currentTarget.value));
          }}
          rows={4}
          value={Array.isArray(current) ? current.join("\n") : ""}
        />
      </FormField>
    );
  }

  return (
    <FormField
      description={explanation}
      error={findingMessage}
      htmlFor={inputId}
      label={label}
      required={required}
      tone={
        field.securityImpact === "none"
          ? field.costImpact === "cost-sensitive"
            ? "warning"
            : "default"
          : "security"
      }
    >
      <Input
        id={inputId}
        onChange={(event) => {
          onChange(updateStringValue(field, event.currentTarget.value));
        }}
        type={
          field.schema.kind === "number" || field.schema.kind === "integer"
            ? "number"
            : "text"
        }
        value={current === undefined ? "" : String(current)}
      />
    </FormField>
  );
}

function candidateDescription(
  candidate: EditorConnectionCandidate,
  mode: "guided" | "professional",
): string {
  const endpoints = `${candidate.source.serviceName} to ${candidate.target.serviceName}.`;
  return mode === "guided"
    ? `${endpoints} Connect ${candidate.source.nodeLabel} to ${candidate.target.nodeLabel}.`
    : endpoints;
}

function CandidateChoice({
  candidates,
  onSelect,
}: {
  readonly candidates: readonly EditorConnectionCandidate[];
  readonly onSelect: (key: string) => void;
}) {
  const { mode } = useModePreference();
  const groups = EDITOR_CONNECTION_CATEGORY_ORDER.flatMap((category) => {
    const members = candidates.filter(
      (candidate) => candidate.relationship.category === category,
    );
    return members.length === 0 ? [] : [{ category, members }];
  });
  return (
    <section className="connection-wizard__section">
      <p className="status-label">Set up connection</p>
      <h3>What should this connection do?</h3>
      <p>
        {mode === "guided"
          ? "Choose the result that matches what you want these services to do."
          : "Choose one supported connection."}
      </p>
      <div className="connection-wizard__categories">
        {groups.map(({ category, members }) => (
          <section key={category}>
            <h4>{editorConnectionCategoryLabel(category)}</h4>
            <RadioGroup
              aria-label={`${editorConnectionCategoryLabel(category)} compatible relationships`}
              legend={editorConnectionCategoryLabel(category)}
              name="connection-candidate"
              onValueChange={onSelect}
              options={members.map((candidate) => ({
                description: (
                  <>
                    <span>{candidateDescription(candidate, mode)}</span>
                    <Findings findings={candidate.findings} />
                  </>
                ),
                disabled: candidate.findings.some(
                  (finding) => finding.severity === "error",
                ),
                label:
                  candidate.relationship.presentationLabel ??
                  candidate.relationship.displayName,
                value: candidate.key,
              }))}
              value=""
            />
          </section>
        ))}
      </div>
    </section>
  );
}

function endpointSummary(candidate: EditorConnectionCandidate) {
  return (
    <dl className="connection-wizard__endpoints">
      <div>
        <dt>Source</dt>
        <dd>
          <strong>{candidate.source.nodeLabel}</strong>
          <span>{candidate.source.portLabel}</span>
          <code>{candidate.source.capability}</code>
          <code>{candidate.source.portId}</code>
        </dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd>
          <strong>{candidate.target.nodeLabel}</strong>
          <span>{candidate.target.portLabel}</span>
          <code>{candidate.target.capability}</code>
          <code>{candidate.target.portId}</code>
        </dd>
      </div>
    </dl>
  );
}

function CardinalityReview({
  candidate,
}: {
  readonly candidate: EditorConnectionCandidate;
}) {
  const rows = [
    ["Source capability port", candidate.cardinality.sourcePort],
    ["Target capability port", candidate.cardinality.targetPort],
    ["Rule from this source", candidate.cardinality.sourceRule],
    ["Rule to this target", candidate.cardinality.targetRule],
    ["Exact endpoint pair", candidate.cardinality.endpointPair],
  ] as const;
  return (
    <section className="connection-wizard__section">
      <h3>Cardinality utilization</h3>
      <dl className="connection-wizard__configuration">
        {rows.map(([label, utilization]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {String(utilization.used)} used /{" "}
              {utilization.maximum === null
                ? "no aggregate port maximum"
                : String(utilization.maximum)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function availabilityText(
  availability: EditorConnectionPreview["sourceAvailability"],
): string {
  if (availability.state === "unknown") {
    return availability.reason;
  }
  const unavailable = availability.regions.filter(
    (region) => region.availability === "unavailable",
  );
  return unavailable.length === 0
    ? `Catalog coverage is ${availability.coverage}; no listed Region is unavailable.`
    : `${unavailable.map((region) => region.region).join(", ")} unavailable in the bound catalog.`;
}

function ConfigurationRecordDetails({
  configuration,
}: {
  readonly configuration: EditorConnectionPreview["generatedResources"][number]["configuration"];
}) {
  return (
    <dl className="connection-wizard__configuration">
      <div>
        <dt>Configuration schema</dt>
        <dd>
          <code>{configuration.schemaId}</code> @{" "}
          <code>{configuration.schemaVersion}</code>
        </dd>
      </div>
      {Object.entries(configuration.values).map(([property, value]) => (
        <div key={property}>
          <dt>
            <code>{property}</code>
          </dt>
          <dd>
            <code>{value.kind}</code>: {connectionConfigurationValueText(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function iamScopeIdentity(
  scope: EditorConnectionPreview["iamEffects"][number]["resourceScope"],
  candidate: EditorConnectionCandidate,
  preview: EditorConnectionPreview,
): string {
  switch (scope) {
    case "source-node":
      return `source node ${candidate.source.nodeLabel} (${candidate.source.nodeId})`;
    case "target-node":
      return `target node ${candidate.target.nodeLabel} (${candidate.target.nodeId})`;
    case "connected-target":
      return `connected target node ${candidate.target.nodeLabel} (${candidate.target.nodeId})`;
    case "supporting-node": {
      const supportingNodes = preview.generatedResources.flatMap((resource) =>
        resource.kind === "node" ? [`${resource.label} (${resource.id})`] : [],
      );
      return supportingNodes.length === 0
        ? "a rule-defined supporting node"
        : `supporting node ${supportingNodes.join(", ")}`;
    }
  }
}
function TechnicalPreviewDetails({
  candidate,
  preview,
}: {
  readonly candidate: EditorConnectionCandidate;
  readonly preview: EditorConnectionPreview;
}) {
  const costFields = preview.relationship.configuration.fields.filter(
    (field) => field.costImpact === "cost-sensitive",
  );
  const summary = `${candidate.source.nodeLabel} will connect from ${candidate.source.portLabel} to ${candidate.target.nodeLabel} through ${preview.relationship.displayName}.${preview.iamEffects.length > 0 ? " The connection will add the required permission." : ""}`;

  return (
    <div className="connection-wizard__review">
      <section className="connection-wizard__section">
        <p className="status-label">Final plain-language summary</p>
        <h3>Review before confirming</h3>
        <p className="connection-wizard__plain-summary">{summary}</p>
        {endpointSummary(candidate)}
        <p>
          Relationship type: <code>{preview.relationship.id}</code>
          <br />
          Rule: <code>{preview.relationship.descriptorId}</code> @{" "}
          <code>{preview.relationship.ruleVersion}</code>
          <br />
          Draft revision: <code>{preview.revisionId}</code>
          <br />
          Atomic batch: <code>{preview.batchCommandId}</code>
        </p>
      </section>

      <CardinalityReview candidate={candidate} />

      <section className="connection-wizard__section">
        <h3>Configuration and route choices</h3>
        {Object.keys(preview.configuration).length === 0 ? (
          <p>No relationship configuration field is declared.</p>
        ) : (
          <dl className="connection-wizard__configuration">
            {Object.entries(preview.configuration).map(([property, value]) => (
              <div key={property}>
                <dt>
                  {preview.relationship.configuration.fields.find(
                    (field) => field.property === property,
                  )?.label ?? property}
                </dt>
                <dd>
                  {connectionConfigurationValueText(value)}{" "}
                  <code>{property}</code>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="connection-wizard__section">
        <h3>Atomic graph changes</h3>
        <p>
          Every row below comes from the Graph Command preview. Confirmation
          applies the same batch or applies nothing.
        </p>
        <ul aria-label="Atomic graph changes">
          {preview.changes.map((change, index) => (
            <li key={`${change.commandId}:${change.kind}:${String(index)}`}>
              <strong>{change.kind.replaceAll("-", " ")}</strong>{" "}
              <code>{graphChangeResourceLabel(change)}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="connection-wizard__section">
        <h3>Generated-resource provenance</h3>
        <>
          {preview.relationship.supportingChanges.length === 0 ? (
            <p>
              This rule declares no additional supporting resource beyond the
              typed connection edge.
            </p>
          ) : (
            <>
              <p>
                The exact bound rule declares these supporting changes and why
                each one is required:
              </p>
              <ul aria-label="Rule-defined supporting changes">
                {preview.relationship.supportingChanges.map((change) => (
                  <li key={change.id}>
                    <strong>{change.purpose}</strong> · {change.kind}{" "}
                    <code>{change.id}</code>
                    <br />
                    {change.kind === "node" ? (
                      <>
                        Service <code>{change.serviceType}</code>
                      </>
                    ) : (
                      <>
                        Relationship <code>{change.relationshipType}</code>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.generatedResources.length === 0 ? (
            <p>No generated resource is present in this resolver preview.</p>
          ) : (
            <ul aria-label="Generated resources">
              {preview.generatedResources.map((resource) => (
                <li key={`${resource.kind}:${resource.id}`}>
                  <strong>{resource.label}</strong> · {resource.kind}{" "}
                  <code>{resource.id}</code>
                  <br />
                  {resource.kind === "node" ? (
                    <>
                      Service <code>{resource.serviceType}</code>; resource{" "}
                      <code>{resource.resourceType}</code>.
                    </>
                  ) : (
                    <>
                      Relationship <code>{resource.relationshipType}</code>.
                      Source <code>{resource.source.nodeId}</code> ·{" "}
                      <code>{resource.source.portId}</code>; target{" "}
                      <code>{resource.target.nodeId}</code> ·{" "}
                      <code>{resource.target.portId}</code>.
                    </>
                  )}
                  <ConfigurationRecordDetails
                    configuration={resource.configuration}
                  />
                  Ownership: {resource.lifecycle.ownership}.
                  {resource.lifecycle.ownership === "generated" ? (
                    <>
                      {" "}
                      Generator <code>
                        {resource.lifecycle.generatorId}
                      </code> @{" "}
                      <code>{resource.lifecycle.generatorVersion}</code>;
                      operation <code>{resource.lifecycle.operationId}</code>.
                      {resource.lifecycle.dependentNodeIds.length === 0
                        ? ""
                        : ` Node dependencies: ${resource.lifecycle.dependentNodeIds.join(", ")}.`}
                      {resource.lifecycle.dependentEdgeIds.length === 0
                        ? ""
                        : ` Edge dependencies: ${resource.lifecycle.dependentEdgeIds.join(", ")}.`}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p>
            Lifecycle: customization{" "}
            {preview.relationship.lifecycle.adoption.replaceAll("-", " ")};
            deletion{" "}
            {preview.relationship.lifecycle.deletion.replaceAll("-", " ")};
            shared resources{" "}
            {preview.relationship.lifecycle.sharedResource.replaceAll("-", " ")}
            .
          </p>
        </>
      </section>

      <section className="connection-wizard__implications">
        <article>
          <LockKeyhole aria-hidden="true" size={18} />
          <h3>Security</h3>
          {preview.iamEffects.length === 0 ? (
            <p>No permission effect is declared for this relationship.</p>
          ) : (
            <ul aria-label="Permission effects">
              {preview.iamEffects.map((effect) => (
                <li key={effect.id}>
                  <p>
                    <strong>{effect.effect}</strong>:{" "}
                    {effect.actions.join(", ")}. Permission{" "}
                    <code>{effect.id}</code>.
                  </p>
                  <p>
                    Scope <code>{effect.resourceScope}</code>:{" "}
                    {iamScopeIdentity(effect.resourceScope, candidate, preview)}
                    .
                  </p>
                  {effect.principal === undefined ? null : (
                    <p>
                      Principal <code>{effect.principal}</code>.
                    </p>
                  )}
                  <p>{effect.explanation}</p>
                  {effect.when === undefined ? null : (
                    <p>
                      Applies when <code>{effect.when.property}</code> equals{" "}
                      <code>{String(effect.when.equals)}</code>.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
        <article>
          <CircleDollarSign aria-hidden="true" size={18} />
          <h3>Cost</h3>
          <p>
            {costFields.length === 0
              ? "No cost-sensitive connection setting is declared."
              : `Review ${costFields.map((field) => field.label).join(", ")}; the catalog marks this tuning as cost-sensitive.`}{" "}
            The catalog provides no price estimate; provider usage may still
            incur charges.
          </p>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" size={18} />
          <h3>Reliability</h3>
          <p>
            No structured reliability effect is declared by Connection Rule v1.
            The catalog considerations below are education, not validation.
          </p>
          {preview.relationship.education.considerations.length === 0 ? (
            <p>No additional rule-specific consideration is declared.</p>
          ) : (
            <ul aria-label="Catalog connection considerations">
              {preview.relationship.education.considerations.map(
                (consideration) => (
                  <li key={consideration}>{consideration}</li>
                ),
              )}
            </ul>
          )}
        </article>
        <article>
          <Cloud aria-hidden="true" size={18} />
          <h3>Availability</h3>
          <p>Source: {availabilityText(preview.sourceAvailability)}</p>
          <p>Target: {availabilityText(preview.targetAvailability)}</p>
        </article>
      </section>

      <section className="connection-wizard__section">
        <h3>Configuration field identifiers</h3>
        <dl>
          {Object.entries(preview.configuration).map(([property, value]) => (
            <div key={property}>
              <dt>{property}</dt>
              <dd>
                <code>
                  {value.kind}: {connectionConfigurationValueText(value)}
                </code>
              </dd>
            </div>
          ))}
        </dl>
        <h3>Batch commands</h3>
        <ul>
          {preview.commands.map((command) => (
            <li key={command.commandId}>
              <code>{command.kind}</code> · <code>{command.commandId}</code>
              {command.targetResourceIds.length === 0
                ? ""
                : ` · targets ${command.targetResourceIds.join(", ")}`}
            </li>
          ))}
        </ul>
        <h3>Whole-architecture IAM requirements</h3>
        {preview.iamRequirements.length === 0 ? (
          <p>No composed IAM requirement is present in the preview document.</p>
        ) : (
          <ul aria-label="Whole-architecture IAM requirements">
            {preview.iamRequirements.map((requirement) => (
              <li
                key={`${requirement.sourceEdgeId}:${requirement.ruleId}:${requirement.effectId}`}
              >
                <strong>{requirement.effect}</strong> ·{" "}
                <code>{requirement.actions.join(", ")}</code>
                <br />
                Source edge <code>{requirement.sourceEdgeId}</code>; rule{" "}
                <code>{requirement.ruleId}</code>; effect{" "}
                <code>{requirement.effectId}</code>.
                <br />
                Resource scope <code>{requirement.resource.scope}</code>
                {"nodeId" in requirement.resource ? (
                  <>
                    {" "}
                    at node <code>{requirement.resource.nodeId}</code>
                  </>
                ) : null}
                . Qualifier edge <code>{requirement.qualifier.edgeId}</code>;{" "}
                schema{" "}
                <code>{requirement.qualifier.configurationSchemaId}</code> @{" "}
                <code>{requirement.qualifier.configurationSchemaVersion}</code>.
                Readiness <code>{requirement.readiness}</code>.
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="connection-wizard__section">
        <h3>Findings and validation references</h3>
        {preview.findings.length === 0 ? (
          <p>No resolver finding is present in this preview.</p>
        ) : (
          <ul aria-label="Technical connection findings">
            {preview.findings.map((finding) => (
              <li key={finding.code}>
                <strong>{finding.severity}</strong> /{" "}
                <code>{finding.code}</code>
                <br />
                Path <code>{finding.path}</code>.
                <br />
                {finding.professionalMessage}
              </li>
            ))}
          </ul>
        )}
        {preview.relationship.validationRuleIds.length === 0 ? (
          <p>No validation rule reference is declared.</p>
        ) : (
          <ul aria-label="Validation rule references">
            {preview.relationship.validationRuleIds.map((ruleId) => (
              <li key={ruleId}>
                <code>{ruleId}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PreviewReview({
  candidate,
  preview,
}: {
  readonly candidate: EditorConnectionCandidate;
  readonly preview: EditorConnectionPreview;
}) {
  const { mode } = useModePreference();
  const fields = preview.relationship.configuration.fields;
  const configurationSummary = Object.entries(preview.configuration)
    .map(([property, value]) =>
      [
        fields.find((field) => field.property === property)?.label ??
          "Connection setting",
        connectionConfigurationValueText(value),
      ].join(": "),
    )
    .join("; ");
  const costFields = fields.filter(
    (field) => field.costImpact === "cost-sensitive",
  );
  const securityFields = fields.filter(
    (field) => field.securityImpact !== "none",
  );
  const hasSecurityConsequences =
    preview.iamEffects.length > 0 || securityFields.length > 0;
  const supportingChangeCount = preview.relationship.supportingChanges.length;
  const eventGuidance = eventDeliveryGuidance(
    preview.relationship.descriptorId,
  );

  return (
    <div className="connection-wizard__review" data-stage="review-and-connect">
      <section className="connection-wizard__section">
        <p className="status-label">Review and connect</p>
        <h3>What will change</h3>
        <p>
          {mode === "guided"
            ? "Check the connection and its declared consequences before it is applied."
            : "Review the connection and declared consequences before applying it."}
        </p>
        <ul aria-label="Connection change summary">
          <li>
            <strong>Connection:</strong> {candidate.source.nodeLabel} (
            {candidate.source.serviceName}) to {candidate.target.nodeLabel} (
            {candidate.target.serviceName}).
          </li>
          {configurationSummary.length === 0 ? null : (
            <li>
              <strong>Settings:</strong> {configurationSummary}.
            </li>
          )}
          {supportingChangeCount === 0 ? null : (
            <li>
              <strong>Supporting changes:</strong>{" "}
              {supportingChangeCount === 1
                ? "One supporting resource or connection."
                : String(supportingChangeCount) +
                  " supporting resources or connections."}
            </li>
          )}
        </ul>
      </section>

      {hasSecurityConsequences ? (
        <section className="connection-wizard__section">
          <LockKeyhole aria-hidden="true" size={18} />
          <h3>Permissions and security</h3>
          {preview.iamEffects.length === 0 ? null : (
            <ul aria-label="Permission consequences">
              {preview.iamEffects.map((effect) => (
                <li key={effect.id}>{effect.explanation}</li>
              ))}
            </ul>
          )}
          {securityFields.length === 0 ? null : (
            <p>
              Security-sensitive settings:{" "}
              {securityFields.map((field) => field.label).join(", ")}.
            </p>
          )}
        </section>
      ) : null}

      {eventGuidance === null ? null : (
        <section
          className="connection-wizard__section"
          aria-labelledby="event-delivery-preview-title"
        >
          <h3 id="event-delivery-preview-title">
            Delivery, ordering, and retry
          </h3>
          <dl className="connection-wizard__configuration">
            <div>
              <dt>Delivery and duplicates</dt>
              <dd>{eventGuidance.delivery}</dd>
            </div>
            <div>
              <dt>Ordering</dt>
              <dd>{eventGuidance.ordering}</dd>
            </div>
            <div>
              <dt>Retry and failure</dt>
              <dd>{eventGuidance.retry}</dd>
            </div>
          </dl>
        </section>
      )}

      {costFields.length === 0 ? null : (
        <section className="connection-wizard__section">
          <CircleDollarSign aria-hidden="true" size={18} />
          <h3>Cost</h3>
          <p>
            {costFields.map((field) => field.label).join(", ")} may affect AWS
            usage charges. The catalog does not provide a price estimate.
          </p>
        </section>
      )}

      {supportingChangeCount === 0 ? null : (
        <section className="connection-wizard__section">
          <AlertTriangle aria-hidden="true" size={18} />
          <h3>Generated supporting resources</h3>
          <p>
            Removing this connection releases generated supporting resources
            only after no other connection uses them. Take ownership before
            customizing a generated resource.
          </p>
        </section>
      )}

      <Findings findings={preview.findings} />

      <details className="connection-wizard__technical">
        <summary>Technical details</summary>
        <TechnicalPreviewDetails candidate={candidate} preview={preview} />
      </details>
    </div>
  );
}

function OpenConnectionWizard() {
  const session = useEditorDocumentSession();
  const { mode } = useModePreference();
  const autoPreviewKeyRef = useRef<string | null>(null);
  const workflow = session.connectionWorkflow;
  const [removalRequested, setRemovalRequested] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const candidate = useMemo(
    () => selectedCandidate(workflow.candidates, workflow.selectedCandidateKey),
    [workflow.candidates, workflow.selectedCandidateKey],
  );
  const fields = useMemo(
    () => candidate?.relationship.configuration.fields ?? [],
    [candidate],
  );
  const configurationIssues = useMemo(
    () =>
      candidate === undefined || fields.length === 0
        ? []
        : workflow.findings
            .filter((finding) => finding.severity === "error")
            .map((finding) => {
              const field = fields.find((item) =>
                findingMatchesProperty(finding, item.property),
              );
              return {
                key: `${finding.code}:${finding.path}`,
                label: field?.label ?? "Connection",
                message:
                  mode === "guided"
                    ? finding.guidedMessage
                    : finding.professionalMessage,
                fieldId:
                  field === undefined
                    ? undefined
                    : `connection-${candidate.relationship.descriptorId}-${field.property}`,
              };
            }),
    [candidate, fields, mode, workflow.findings],
  );
  const editedEdge =
    workflow.editingEdgeId === null
      ? undefined
      : session.document?.edges.find(
          (edge) => edge.id === workflow.editingEdgeId,
        );
  const changesConnection =
    candidate !== undefined &&
    editedEdge !== undefined &&
    (candidate.relationship.id !== editedEdge.semantic.relationshipType ||
      candidate.source.nodeId !== editedEdge.semantic.source.nodeId ||
      candidate.source.portId !== editedEdge.semantic.source.port ||
      candidate.target.nodeId !== editedEdge.semantic.target.nodeId ||
      candidate.target.portId !== editedEdge.semantic.target.port);
  const canUpdate =
    workflow.editingEdgeId === null || fields.length > 0 || changesConnection;
  const hasBlockingFindings = workflow.findings.some(
    (finding) => finding.severity === "error",
  );

  useEffect(() => {
    if (
      !workflow.open ||
      candidate === undefined ||
      workflow.preview !== null ||
      fields.length !== 0 ||
      hasBlockingFindings
    ) {
      return;
    }
    const previewKey = [
      workflow.editingEdgeId ?? "new",
      workflow.selectedCandidateKey ?? "candidate",
    ].join(":");
    if (autoPreviewKeyRef.current === previewKey) {
      return;
    }
    autoPreviewKeyRef.current = previewKey;
    session.previewConnection();
  }, [
    candidate,
    fields.length,
    hasBlockingFindings,
    session,
    workflow.editingEdgeId,
    workflow.open,
    workflow.preview,
    workflow.selectedCandidateKey,
  ]);

  useEffect(() => {
    if (
      !workflow.open ||
      workflow.preview === null ||
      removalRequested ||
      !canUpdate
    ) {
      return undefined;
    }
    const handleKeyboardConfirmation = (
      event: globalThis.KeyboardEvent,
    ): void => {
      const openModals = document.querySelectorAll<HTMLElement>(
        "[data-cm-modal-drawer]",
      );
      const topmostModal = openModals[openModals.length - 1];
      if (
        topmostModal === undefined ||
        !topmostModal.classList.contains("connection-wizard") ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key !== "Enter"
      ) {
        return;
      }
      event.preventDefault();
      session.applyConnectionPreview();
    };
    document.addEventListener("keydown", handleKeyboardConfirmation);
    return () => {
      document.removeEventListener("keydown", handleKeyboardConfirmation);
    };
  }, [canUpdate, removalRequested, session, workflow.open, workflow.preview]);

  const availableCandidates = workflow.candidates.filter(
    (item) => !item.findings.some((finding) => finding.severity === "error"),
  );
  const invalid = availableCandidates.length === 0 && candidate === undefined;
  const choosing = availableCandidates.length > 1 && candidate === undefined;
  const reviewing = candidate !== undefined && workflow.preview !== null;
  const dialogTitle =
    candidate === undefined
      ? invalid
        ? "Connection unavailable"
        : "Choose services to connect"
      : workflow.editingEdgeId === null
        ? `Connect ${candidate.source.serviceName} to ${candidate.target.serviceName}`
        : `${!canUpdate ? "Manage" : "Update"} ${candidate.source.serviceName} to ${candidate.target.serviceName} connection`;
  const dialogDescription =
    candidate?.relationship.description ??
    workflow.candidates[0]?.relationship.description ??
    "Choose one supported connection.";

  const preparePreview = () => {
    session.previewConnection();
  };
  const confirm = () => {
    session.applyConnectionPreview();
  };

  return (
    <Dialog
      className="connection-wizard"
      description={dialogDescription}
      footer={
        <div className="connection-wizard__footer">
          <Button
            onClick={() => {
              session.cancelConnection();
            }}
            variant="quiet"
          >
            {invalid ? "Close" : "Cancel"}
          </Button>
          {workflow.editingEdgeId !== null && !removalRequested ? (
            <Button
              onClick={() => {
                setRemovalRequested(true);
                setRemovalError("");
              }}
              variant="danger"
            >
              Remove connection
            </Button>
          ) : null}
          {removalRequested ? (
            <>
              <Button
                onClick={() => {
                  setRemovalRequested(false);
                }}
                variant="secondary"
              >
                Keep connection
              </Button>
              <Button
                onClick={() => {
                  const edgeId = workflow.editingEdgeId;
                  if (edgeId === null) return;
                  const result = session.disconnectEdge(edgeId);
                  if (!result.ok) setRemovalError(result.message);
                }}
                variant="danger"
              >
                Confirm removal
              </Button>
            </>
          ) : reviewing ? (
            <>
              {fields.length === 0 ? null : (
                <Button
                  onClick={() => {
                    session.discardConnectionPreview();
                  }}
                  variant="secondary"
                >
                  <ArrowLeft aria-hidden="true" size={16} /> Back
                </Button>
              )}
              {canUpdate ? (
                <Button onClick={confirm} title="Ctrl/Command+Enter">
                  <Check aria-hidden="true" size={16} />{" "}
                  {workflow.editingEdgeId === null
                    ? "Connect"
                    : "Update connection"}
                </Button>
              ) : null}
            </>
          ) : candidate === undefined ||
            invalid ||
            fields.length === 0 ? null : (
            <Button disabled={hasBlockingFindings} onClick={preparePreview}>
              Review connection
            </Button>
          )}
        </div>
      }
      onClose={() => {
        session.cancelConnection();
      }}
      open
      title={dialogTitle}
    >
      <div className="connection-wizard__body">
        {removalRequested ? (
          <section className="connection-wizard__section" role="status">
            <h3>Remove this connection?</h3>
            <p>
              The connection, its workload binding, and unused generated
              permissions or supporting resources will be removed together.
              Shared resources stay in the design. You can undo the change.
            </p>
            {removalError === "" ? null : <p role="alert">{removalError}</p>}
          </section>
        ) : invalid ? (
          <>
            <section className="connection-wizard__section">
              <p className="status-label">Connection rejected</p>
              <h3>These endpoints cannot be connected</h3>
              <Findings findings={workflow.findings} />
              <EducationLink
                education={
                  workflow.candidates[0]?.relationship.education ??
                  workflow.education
                }
              />
            </section>
            <SetupTechnicalDetails
              candidate={workflow.candidates[0]}
              configuration={workflow.configuration}
              findings={workflow.findings}
            />
          </>
        ) : choosing ? (
          <CandidateChoice
            candidates={workflow.candidates}
            onSelect={(candidateKey) => {
              session.selectConnectionCandidate(candidateKey);
            }}
          />
        ) : candidate === undefined ? (
          <>
            <section className="connection-wizard__section">
              <h3>Choose a compatible relationship</h3>
              <Findings findings={workflow.findings} />
            </section>
            <SetupTechnicalDetails
              candidate={undefined}
              configuration={workflow.configuration}
              findings={workflow.findings}
            />
          </>
        ) : reviewing ? (
          <>
            {workflow.editingEdgeId !== null && !canUpdate ? (
              <p>
                This connection has no adjustable settings. Review it here or
                remove it.
              </p>
            ) : null}
            <PreviewReview candidate={candidate} preview={workflow.preview} />
          </>
        ) : fields.length === 0 ? (
          hasBlockingFindings ? (
            <>
              <section
                className="connection-wizard__section"
                data-stage="setup-connection"
              >
                <p className="status-label">Connection blocked</p>
                <h3>This connection needs attention</h3>
                <Findings findings={workflow.findings} />
              </section>
              <SetupTechnicalDetails
                candidate={candidate}
                configuration={workflow.configuration}
                findings={workflow.findings}
              />
            </>
          ) : null
        ) : (
          <>
            <section
              className="connection-wizard__section"
              data-stage="setup-connection"
            >
              <p className="status-label">Set up connection</p>
              <h3>
                Connect {candidate.source.nodeLabel} to{" "}
                {candidate.target.nodeLabel}
              </h3>
              <p>
                {mode === "guided"
                  ? candidate.relationship.education.guidedExplanation
                  : "Review the connection settings and declared consequences."}
              </p>
              <EducationLink education={candidate.relationship.education} />
            </section>
            <section className="connection-wizard__section">
              <h3>Connection settings</h3>
              {fields.map((field) => (
                <ConfigurationControl
                  candidate={candidate}
                  field={field}
                  finding={workflow.findings.find((finding) =>
                    findingMatchesProperty(finding, field.property),
                  )}
                  key={field.property}
                  mode={mode}
                  onChange={(value) => {
                    session.updateConnectionConfiguration(
                      field.property,
                      value,
                    );
                  }}
                  value={workflow.configuration[field.property]}
                />
              ))}
              <Findings
                findings={workflow.findings.filter(
                  (finding) =>
                    finding.severity !== "error" &&
                    !fields.some((field) =>
                      findingMatchesProperty(finding, field.property),
                    ),
                )}
              />
              <ConfigurationErrorSummary issues={configurationIssues} />
              {configurationIssues.some(
                (issue) => issue.fieldId === undefined,
              ) ? (
                <p className="connection-wizard__recovery">
                  Review the blocking condition in Technical details, or cancel
                  to keep the current diagram.
                </p>
              ) : null}
            </section>
            <SetupTechnicalDetails
              candidate={candidate}
              configuration={workflow.configuration}
              findings={workflow.findings}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ConnectionWizard() {
  const session = useEditorDocumentSession();
  return session.connectionWorkflow.open ? <OpenConnectionWizard /> : null;
}
function SetupTechnicalDetails({
  candidate,
  configuration,
  findings,
}: {
  readonly candidate: EditorConnectionCandidate | undefined;
  readonly configuration: Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  readonly findings: readonly EditorConnectionFinding[];
}) {
  return (
    <details className="connection-wizard__technical">
      <summary>Technical details</summary>
      {candidate === undefined ? null : (
        <>
          {endpointSummary(candidate)}
          <p>
            Relationship <code>{candidate.relationship.id}</code>.
            <br />
            Rule <code>{candidate.relationship.descriptorId}</code> @{" "}
            <code>{candidate.relationship.ruleVersion}</code>.
          </p>
          <CardinalityReview candidate={candidate} />
          <section className="connection-wizard__section">
            <h3>Configuration schema</h3>
            <p>
              <code>{candidate.relationship.configuration.schemaId}</code> @{" "}
              <code>{candidate.relationship.configuration.schemaVersion}</code>
            </p>
            {candidate.relationship.configuration.fields.length === 0 ? (
              <p>No configuration field is declared.</p>
            ) : (
              <ul aria-label="Technical configuration fields">
                {candidate.relationship.configuration.fields.map((field) => {
                  const currentValue = configuration[field.property];
                  return (
                    <li key={field.property}>
                      <code>{field.property}</code> /{" "}
                      <code>{field.schema.kind}</code> /{" "}
                      {field.required ? "required" : "optional"} /{" "}
                      <code>{field.valueSource}</code>
                      <br />
                      {currentValue === undefined ? (
                        <>
                          Current value: <code>unset</code>.
                        </>
                      ) : (
                        <>
                          Current value kind <code>{currentValue.kind}</code>:{" "}
                          <code>
                            {connectionConfigurationValueText(currentValue)}
                          </code>
                          .
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="connection-wizard__section">
            <h3>Validation rule references</h3>
            {candidate.relationship.validationRuleIds.length === 0 ? (
              <p>No validation rule reference is declared.</p>
            ) : (
              <ul aria-label="Validation rule references">
                {candidate.relationship.validationRuleIds.map((ruleId) => (
                  <li key={ruleId}>
                    <code>{ruleId}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <section className="connection-wizard__section">
        <h3>Findings</h3>
        {findings.length === 0 ? (
          <p>No resolver finding is present.</p>
        ) : (
          <ul aria-label="Technical connection findings">
            {findings.map((finding) => (
              <li key={finding.code}>
                <strong>{finding.severity}</strong> /{" "}
                <code>{finding.code}</code> ? path <code>{finding.path}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </details>
  );
}
