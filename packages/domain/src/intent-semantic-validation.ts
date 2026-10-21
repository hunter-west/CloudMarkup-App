import type { IntentDocumentV1 } from "@cloudmarkup/schemas";

export type IntentDocumentSemanticIssueCode =
  | "broken_capability_reference"
  | "broken_selected_alternative_reference"
  | "broken_superseded_decision_reference"
  | "broken_unknown_question_reference"
  | "conflicting_active_decisions"
  | "decision_alternative_subject_mismatch"
  | "duplicate_alternative_id"
  | "duplicate_assumption_id"
  | "duplicate_capability_id"
  | "duplicate_capability_type"
  | "duplicate_compliance_id"
  | "duplicate_connectivity_id"
  | "duplicate_data_category_id"
  | "duplicate_decision_id"
  | "duplicate_latency_percentile"
  | "duplicate_question_id"
  | "duplicate_scale_metric"
  | "duplicate_workflow_id"
  | "invalid_retention_range"
  | "invalid_scale_peak"
  | "non_monotonic_latency_targets"
  | "prompt_provenance_required"
  | "selected_alternative_state_mismatch"
  | "selected_alternative_without_decision"
  | "self_superseded_decision"
  | "superseded_decision_state_mismatch"
  | "unexpected_prompt_provenance"
  | "unresolved_decided_subject";

export interface IntentDocumentSemanticIssue {
  readonly code: IntentDocumentSemanticIssueCode;
  readonly message: string;
  readonly path: string;
}

interface PathEntry<T> {
  readonly item: T;
  readonly path: string;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function duplicateIssues<T>(
  entries: readonly PathEntry<T>[],
  valueOf: (item: T) => string,
  code: IntentDocumentSemanticIssueCode,
  label: string,
): readonly IntentDocumentSemanticIssue[] {
  const firstPathByValue = new Map<string, string>();
  const issues: IntentDocumentSemanticIssue[] = [];

  entries.forEach(({ item, path }) => {
    const value = valueOf(item);
    const firstPath = firstPathByValue.get(value);

    if (firstPath === undefined) {
      firstPathByValue.set(value, path);
      return;
    }

    issues.push({
      code,
      message: `Duplicate ${label}; first declared at ${firstPath}.`,
      path,
    });
  });

  return issues;
}

function indexedEntries<T>(
  items: readonly T[],
  path: string,
): readonly PathEntry<T>[] {
  return items.map((item, index) => ({
    item,
    path: `${path}[${String(index)}]`,
  }));
}

function validateUnknownReference(
  questionId: string,
  path: string,
  questionIds: ReadonlySet<string>,
): readonly IntentDocumentSemanticIssue[] {
  if (questionIds.has(questionId)) {
    return [];
  }

  return [
    {
      code: "broken_unknown_question_reference",
      message:
        "Unknown value references an unresolved question that is absent.",
      path,
    },
  ];
}

function validateCapabilityReferences(
  capabilityIds: readonly string[],
  path: string,
  knownCapabilityIds: ReadonlySet<string>,
): readonly IntentDocumentSemanticIssue[] {
  return capabilityIds.flatMap((capabilityId, index) =>
    knownCapabilityIds.has(capabilityId)
      ? []
      : [
          {
            code: "broken_capability_reference" as const,
            message:
              "Requirement references a workload capability that is absent.",
            path: `${path}[${String(index)}]`,
          },
        ],
  );
}

function validateUnknownValues(
  document: IntentDocumentV1,
  questionIds: ReadonlySet<string>,
): readonly IntentDocumentSemanticIssue[] {
  const issues: IntentDocumentSemanticIssue[] = [];

  const check = (
    value: { state: string; questionId?: string },
    path: string,
  ) => {
    if (value.state === "unknown" && value.questionId !== undefined) {
      issues.push(
        ...validateUnknownReference(
          value.questionId,
          `${path}.questionId`,
          questionIds,
        ),
      );
    }
  };

  check(document.application.capabilities, "$.application.capabilities");
  check(document.connectivity.ingress, "$.connectivity.ingress");
  check(document.connectivity.egress, "$.connectivity.egress");
  check(document.identity.authentication, "$.identity.authentication");
  check(document.identity.authorization, "$.identity.authorization");
  check(document.data, "$.data");
  check(document.workflows, "$.workflows");
  check(document.quality.availability, "$.quality.availability");
  check(document.quality.durability, "$.quality.durability");
  check(document.quality.recovery, "$.quality.recovery");
  check(document.quality.latency, "$.quality.latency");
  check(document.quality.scale, "$.quality.scale");
  check(document.environment, "$.environment");
  check(
    document.preferences.operationalOverhead,
    "$.preferences.operationalOverhead",
  );
  check(document.preferences.cost, "$.preferences.cost");
  check(document.compliance, "$.compliance");

  if (document.preferences.cost.state === "known") {
    check(document.preferences.cost.budget, "$.preferences.cost.budget");
  }

  if (document.data.state === "known") {
    document.data.items.forEach((category, index) => {
      check(category.sensitivity, `$.data.items[${String(index)}].sensitivity`);
      check(category.retention, `$.data.items[${String(index)}].retention`);
      check(category.residency, `$.data.items[${String(index)}].residency`);
    });
  }

  if (document.workflows.state === "known") {
    document.workflows.items.forEach((workflow, index) => {
      check(
        workflow.execution,
        `$.workflows.items[${String(index)}].execution`,
      );
      check(workflow.trigger, `$.workflows.items[${String(index)}].trigger`);
    });
  }

  return issues;
}

function validateLatency(
  document: IntentDocumentV1,
): readonly IntentDocumentSemanticIssue[] {
  if (document.quality.latency.state !== "known") {
    return [];
  }

  const targets = document.quality.latency.targets;
  const issues = [
    ...duplicateIssues(
      indexedEntries(targets, "$.quality.latency.targets"),
      (target) => target.percentile,
      "duplicate_latency_percentile" as const,
      "latency percentile",
    ),
  ];
  const byPercentile = new Map(
    targets.map((target) => [target.percentile, target.milliseconds] as const),
  );
  const p50 = byPercentile.get("p50");
  const p95 = byPercentile.get("p95");
  const p99 = byPercentile.get("p99");

  if (
    (p50 !== undefined && p95 !== undefined && p50 > p95) ||
    (p95 !== undefined && p99 !== undefined && p95 > p99) ||
    (p50 !== undefined && p99 !== undefined && p50 > p99)
  ) {
    issues.push({
      code: "non_monotonic_latency_targets",
      message:
        "Higher latency percentiles cannot have lower targets than lower percentiles.",
      path: "$.quality.latency.targets",
    });
  }

  return issues;
}

function validateScale(
  document: IntentDocumentV1,
): readonly IntentDocumentSemanticIssue[] {
  if (document.quality.scale.state !== "known") {
    return [];
  }

  const metrics = document.quality.scale.metrics;
  const issues = [
    ...duplicateIssues(
      indexedEntries(metrics, "$.quality.scale.metrics"),
      (metric) => metric.metric,
      "duplicate_scale_metric" as const,
      "scale metric",
    ),
  ];
  const byMetric = new Map(
    metrics.map((metric) => [metric.metric, metric.value] as const),
  );
  const steady = byMetric.get("steady-requests-per-second");
  const peak = byMetric.get("peak-requests-per-second");

  if (steady !== undefined && peak !== undefined && peak < steady) {
    issues.push({
      code: "invalid_scale_peak",
      message:
        "Peak requests per second cannot be lower than steady requests per second.",
      path: "$.quality.scale.metrics",
    });
  }

  return issues;
}

function validateDecisionsAndAlternatives(
  document: IntentDocumentV1,
): readonly IntentDocumentSemanticIssue[] {
  const issues: IntentDocumentSemanticIssue[] = [];
  const decisionIndexById = new Map(
    document.decisions.map((decision, index) => [decision.id, index] as const),
  );
  const decisionById = new Map(
    document.decisions.map((decision) => [decision.id, decision] as const),
  );
  const alternativeIndexById = new Map(
    document.alternatives.map(
      (alternative, index) => [alternative.id, index] as const,
    ),
  );
  const alternativeById = new Map(
    document.alternatives.map(
      (alternative) => [alternative.id, alternative] as const,
    ),
  );
  const activeDecisionBySubject = new Map<string, number>();

  document.decisions.forEach((decision, index) => {
    if (decision.status === "active") {
      const firstIndex = activeDecisionBySubject.get(decision.subject);
      if (firstIndex === undefined) {
        activeDecisionBySubject.set(decision.subject, index);
      } else {
        issues.push({
          code: "conflicting_active_decisions",
          message: `Only one active decision may exist for a subject; first declared at $.decisions[${String(firstIndex)}].`,
          path: `$.decisions[${String(index)}].subject`,
        });
      }
    }

    if (decision.selectedAlternativeId !== undefined) {
      const alternative = alternativeById.get(decision.selectedAlternativeId);
      if (alternative === undefined) {
        issues.push({
          code: "broken_selected_alternative_reference",
          message: "Decision selects an alternative that does not exist.",
          path: `$.decisions[${String(index)}].selectedAlternativeId`,
        });
      } else {
        if (alternative.subject !== decision.subject) {
          issues.push({
            code: "decision_alternative_subject_mismatch",
            message: "Decision and selected alternative must share a subject.",
            path: `$.decisions[${String(index)}].selectedAlternativeId`,
          });
        }

        if (decision.status === "active" && alternative.status !== "selected") {
          issues.push({
            code: "selected_alternative_state_mismatch",
            message:
              "An alternative selected by an active decision must have selected status.",
            path: `$.alternatives[${String(alternativeIndexById.get(alternative.id))}].status`,
          });
        }
      }
    }

    if (decision.supersedesDecisionId !== undefined) {
      if (decision.supersedesDecisionId === decision.id) {
        issues.push({
          code: "self_superseded_decision",
          message: "A decision cannot supersede itself.",
          path: `$.decisions[${String(index)}].supersedesDecisionId`,
        });
      } else {
        const superseded = decisionById.get(decision.supersedesDecisionId);
        if (superseded === undefined) {
          issues.push({
            code: "broken_superseded_decision_reference",
            message: "Decision supersedes a decision that does not exist.",
            path: `$.decisions[${String(index)}].supersedesDecisionId`,
          });
        } else if (superseded.status !== "superseded") {
          issues.push({
            code: "superseded_decision_state_mismatch",
            message:
              "A referenced superseded decision must have superseded status.",
            path: `$.decisions[${String(decisionIndexById.get(superseded.id))}].status`,
          });
        }
      }
    }
  });

  document.unresolvedQuestions.forEach((question, index) => {
    if (activeDecisionBySubject.has(question.subject)) {
      issues.push({
        code: "unresolved_decided_subject",
        message:
          "A subject with an active decision cannot remain an unresolved question.",
        path: `$.unresolvedQuestions[${String(index)}].subject`,
      });
    }
  });

  const selectedAlternativeBySubject = new Map<string, number>();
  const selectedAlternativeIds = new Set(
    document.decisions
      .filter((decision) => decision.status === "active")
      .flatMap((decision) =>
        decision.selectedAlternativeId === undefined
          ? []
          : [decision.selectedAlternativeId],
      ),
  );

  document.alternatives.forEach((alternative, index) => {
    if (alternative.status !== "selected") {
      return;
    }

    const firstIndex = selectedAlternativeBySubject.get(alternative.subject);
    if (firstIndex === undefined) {
      selectedAlternativeBySubject.set(alternative.subject, index);
    } else {
      issues.push({
        code: "selected_alternative_state_mismatch",
        message: `Only one alternative may be selected for a subject; first declared at $.alternatives[${String(firstIndex)}].`,
        path: `$.alternatives[${String(index)}].status`,
      });
    }

    if (!selectedAlternativeIds.has(alternative.id)) {
      issues.push({
        code: "selected_alternative_without_decision",
        message:
          "A selected alternative must be referenced by an active decision.",
        path: `$.alternatives[${String(index)}].status`,
      });
    }
  });

  return issues;
}

export function validateIntentDocumentSemantics(
  document: IntentDocumentV1,
): readonly IntentDocumentSemanticIssue[] {
  const issues: IntentDocumentSemanticIssue[] = [];
  const capabilities =
    document.application.capabilities.state === "known"
      ? document.application.capabilities.items
      : [];
  const capabilityIds = new Set(capabilities.map((item) => item.id));
  const questionIds = new Set(
    document.unresolvedQuestions.map((question) => question.id),
  );
  const connectivityEntries = [
    ...(document.connectivity.ingress.state === "known"
      ? indexedEntries(
          document.connectivity.ingress.items,
          "$.connectivity.ingress.items",
        )
      : []),
    ...(document.connectivity.egress.state === "known"
      ? indexedEntries(
          document.connectivity.egress.items,
          "$.connectivity.egress.items",
        )
      : []),
  ];

  issues.push(
    ...duplicateIssues(
      indexedEntries(capabilities, "$.application.capabilities.items"),
      (item) => item.id,
      "duplicate_capability_id",
      "capability requirement ID",
    ),
    ...duplicateIssues(
      indexedEntries(capabilities, "$.application.capabilities.items"),
      (item) => item.capability,
      "duplicate_capability_type",
      "workload capability type",
    ),
    ...duplicateIssues(
      connectivityEntries,
      (item) => item.id,
      "duplicate_connectivity_id",
      "connectivity requirement ID",
    ),
    ...duplicateIssues(
      indexedEntries(
        document.data.state === "known" ? document.data.items : [],
        "$.data.items",
      ),
      (item) => item.id,
      "duplicate_data_category_id",
      "data category ID",
    ),
    ...duplicateIssues(
      indexedEntries(
        document.workflows.state === "known" ? document.workflows.items : [],
        "$.workflows.items",
      ),
      (item) => item.id,
      "duplicate_workflow_id",
      "workflow requirement ID",
    ),
    ...duplicateIssues(
      indexedEntries(
        document.compliance.state === "known" ? document.compliance.items : [],
        "$.compliance.items",
      ),
      (item) => item.id,
      "duplicate_compliance_id",
      "compliance constraint ID",
    ),
    ...duplicateIssues(
      indexedEntries(document.assumptions, "$.assumptions"),
      (item) => item.id,
      "duplicate_assumption_id",
      "assumption ID",
    ),
    ...duplicateIssues(
      indexedEntries(document.unresolvedQuestions, "$.unresolvedQuestions"),
      (item) => item.id,
      "duplicate_question_id",
      "unresolved question ID",
    ),
    ...duplicateIssues(
      indexedEntries(document.decisions, "$.decisions"),
      (item) => item.id,
      "duplicate_decision_id",
      "user decision ID",
    ),
    ...duplicateIssues(
      indexedEntries(document.alternatives, "$.alternatives"),
      (item) => item.id,
      "duplicate_alternative_id",
      "candidate alternative ID",
    ),
    ...validateUnknownValues(document, questionIds),
  );

  connectivityEntries.forEach(({ item, path }) => {
    issues.push(
      ...validateCapabilityReferences(
        item.capabilityIds,
        `${path}.capabilityIds`,
        capabilityIds,
      ),
    );
  });

  if (document.data.state === "known") {
    document.data.items.forEach((category, index) => {
      issues.push(
        ...validateCapabilityReferences(
          category.capabilityIds,
          `$.data.items[${String(index)}].capabilityIds`,
          capabilityIds,
        ),
      );

      if (
        category.retention.state === "known" &&
        category.retention.maximumDays !== undefined &&
        category.retention.minimumDays > category.retention.maximumDays
      ) {
        issues.push({
          code: "invalid_retention_range",
          message:
            "Maximum retention days cannot be lower than minimum retention days.",
          path: `$.data.items[${String(index)}].retention.maximumDays`,
        });
      }
    });
  }

  if (document.workflows.state === "known") {
    document.workflows.items.forEach((workflow, index) => {
      issues.push(
        ...validateCapabilityReferences(
          workflow.capabilityIds,
          `$.workflows.items[${String(index)}].capabilityIds`,
          capabilityIds,
        ),
      );
    });
  }

  issues.push(
    ...validateLatency(document),
    ...validateScale(document),
    ...validateDecisionsAndAlternatives(document),
  );

  if (
    document.metadata.source === "prompt-assisted" &&
    document.metadata.provenance.prompt.kind !== "prompt-reference"
  ) {
    issues.push({
      code: "prompt_provenance_required",
      message:
        "Prompt-assisted intent must include provider-neutral prompt provenance.",
      path: "$.metadata.provenance.prompt",
    });
  }

  if (
    document.metadata.source !== "prompt-assisted" &&
    document.metadata.provenance.prompt.kind === "prompt-reference"
  ) {
    issues.push({
      code: "unexpected_prompt_provenance",
      message:
        "Prompt provenance is only valid when the document source is prompt-assisted.",
      path: "$.metadata.provenance.prompt",
    });
  }

  return issues.sort(
    (left, right) =>
      compareUtf16(left.path, right.path) ||
      compareUtf16(left.code, right.code) ||
      compareUtf16(left.message, right.message),
  );
}

export function formatIntentDocumentSemanticIssues(
  issues: readonly IntentDocumentSemanticIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class IntentDocumentSemanticError extends Error {
  public readonly issues: readonly IntentDocumentSemanticIssue[];

  public constructor(issues: readonly IntentDocumentSemanticIssue[]) {
    super(formatIntentDocumentSemanticIssues(issues));
    this.name = "IntentDocumentSemanticError";
    this.issues = issues;
  }
}
