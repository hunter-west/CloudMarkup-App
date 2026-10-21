import {
  architectureDocumentV1Schema,
  architectureDocumentV2Schema,
  architectureDocumentV3Schema,
  catalogIdSchema,
  edgeIdSchema,
  nodeIdSchema,
  normalizeArchitectureDocumentV2,
  normalizeArchitectureDocumentV3,
  parseGraphCommandV1,
  portTypeSchema,
  providerIdSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  type GraphCommandBatchV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  getArchitectureDocumentHashes,
  getStructurallyValidArchitectureDocumentContentHash,
  hashCanonicalValue,
} from "./document-hashing.js";
import { applyGraphCommand } from "./graph-commands.js";
import { providerNeutralValidationRules } from "./provider-neutral-validation-rules.js";
import {
  VALIDATION_ENGINE_VERSION,
  VALIDATION_ENVIRONMENTS,
  VALIDATION_REPORT_VERSION,
  VALIDATION_RULE_INTERFACE_VERSION,
  VALIDATION_SEVERITIES,
  VALIDATION_TARGETS,
  createValidationDocumentPath,
  createValidationFindingId,
  createValidationRuleId,
  defineValidationRuleV1,
  isValidationDocumentPath,
  isValidationDocumentationPath,
  isValidationDocumentationUrl,
  type ArchitectureValidationRequest,
  type ValidationArchitectureDocument,
  type ValidatedAutoFixPreview,
  type ValidationAffectedLocation,
  type ValidationDocumentationReference,
  type ValidationEngineDiagnostic,
  type ValidationFinding,
  type ValidationFindingCandidate,
  type ValidationFindingId,
  type ValidationFindingRuleReference,
  type ValidationPortInventory,
  type ValidationReport,
  type ValidationRuleContextV1,
  type ValidationRuleId,
  type ValidationRuleV1,
  type ValidationSeverity,
} from "./validation-contract.js";

const severities = new Set<ValidationSeverity>(VALIDATION_SEVERITIES);

const severityOrder: Readonly<Record<ValidationSeverity, number>> = {
  "security-error": 0,
  error: 1,
  "cost-warning": 2,
  warning: 3,
  recommendation: 4,
  "educational-note": 5,
};

const targets = new Set<string>(VALIDATION_TARGETS);
const environments = new Set<string>(VALIDATION_ENVIRONMENTS);

interface CandidateRecord {
  readonly candidate: ValidationFindingCandidate;
  readonly rule: ValidationFindingRuleReference;
}

interface DraftFinding {
  readonly findingId: ValidationFindingId;
  readonly code: ValidationFinding["code"];
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly beginnerExplanation: string;
  readonly technicalExplanation: string;
  readonly affected: readonly ValidationAffectedLocation[];
  readonly documentationReferences: readonly ValidationDocumentationReference[];
  readonly rules: readonly ValidationFindingRuleReference[];
  readonly autoFix?: {
    readonly command: GraphCommandBatchV1;
    readonly ruleId: ValidationRuleId;
  };
}

interface AutoFixRecord {
  readonly findingId: ValidationFindingId;
  readonly ruleId: ValidationRuleId;
  readonly preview: Omit<ValidatedAutoFixPreview, "conflictsWithFindingIds">;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneValidationInput(value: unknown): unknown {
  try {
    return cloneJsonValue(value);
  } catch {
    return undefined;
  }
}

function parseValidationDocument(
  input: unknown,
): ValidationArchitectureDocument | undefined {
  const current = architectureDocumentV3Schema.safeParse(input);
  if (current.success) {
    return normalizeArchitectureDocumentV3(current.data);
  }

  const previousV2 = architectureDocumentV2Schema.safeParse(input);
  if (previousV2.success) {
    return normalizeArchitectureDocumentV2(previousV2.data);
  }

  const previousV1 = architectureDocumentV1Schema.safeParse(input);
  if (!previousV1.success) {
    return undefined;
  }

  return normalizeArchitectureDocumentV2({
    ...previousV1.data,
    schemaVersion: 2,
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  Object.values(value).forEach((entry) => {
    deepFreeze(entry, seen);
  });

  return Object.freeze(value);
}

function diagnostic(
  code: ValidationEngineDiagnostic["code"],
  message: string,
  options: {
    readonly ruleId?: ValidationRuleId;
    readonly findingId?: ValidationFindingId;
  } = {},
): ValidationEngineDiagnostic {
  return {
    code,
    message,
    path: createValidationDocumentPath("$"),
    ...options,
  };
}

function safeInputHash(
  input: unknown,
  document: ValidationArchitectureDocument | undefined,
): Sha256Digest {
  if (document !== undefined) {
    return getStructurallyValidArchitectureDocumentContentHash(document);
  }

  try {
    return hashCanonicalValue({
      kind: "cloudmarkup.validation-input",
      document: input,
    });
  } catch {
    return hashCanonicalValue({
      kind: "cloudmarkup.unhashable-validation-input",
      valueType: typeof input,
    });
  }
}

function isValidRuleDefinition(rule: unknown): rule is ValidationRuleV1 {
  if (!isRecord(rule) || !isRecord(rule["applicability"])) {
    return false;
  }

  const applicability = rule["applicability"];
  const providers = applicability["providers"];
  const catalogs = applicability["catalogs"];
  const applicabilityTargets = applicability["targets"];
  const applicabilityEnvironments = applicability["environments"];

  if (
    rule["interfaceVersion"] !== VALIDATION_RULE_INTERFACE_VERSION ||
    !providerIdSchema.safeParse(rule["id"]).success ||
    !semanticVersionSchema.safeParse(rule["ruleVersion"]).success ||
    (rule["input"] !== "envelope" &&
      rule["input"] !== "architecture-document") ||
    typeof rule["evaluate"] !== "function" ||
    !Array.isArray(applicabilityTargets) ||
    applicabilityTargets.length === 0 ||
    !applicabilityTargets.every(
      (target) => typeof target === "string" && targets.has(target),
    ) ||
    !Array.isArray(applicabilityEnvironments) ||
    applicabilityEnvironments.length === 0 ||
    !applicabilityEnvironments.every(
      (environment) =>
        typeof environment === "string" && environments.has(environment),
    )
  ) {
    return false;
  }

  if (
    !isRecord(providers) ||
    (providers["kind"] !== "all" &&
      (providers["kind"] !== "include" ||
        !Array.isArray(providers["providerIds"]) ||
        providers["providerIds"].length === 0 ||
        !providers["providerIds"].every(
          (providerId) => providerIdSchema.safeParse(providerId).success,
        )))
  ) {
    return false;
  }

  return (
    isRecord(catalogs) &&
    (catalogs["kind"] === "all" ||
      (catalogs["kind"] === "include" &&
        Array.isArray(catalogs["catalogs"]) &&
        catalogs["catalogs"].length > 0 &&
        catalogs["catalogs"].every(
          (catalog) =>
            isRecord(catalog) &&
            catalogIdSchema.safeParse(catalog["catalogId"]).success &&
            Array.isArray(catalog["versions"]) &&
            catalog["versions"].length > 0 &&
            catalog["versions"].every(
              (version) => semanticVersionSchema.safeParse(version).success,
            ),
        )))
  );
}

function ruleApplies(
  rule: ValidationRuleV1,
  context: ValidationRuleContextV1,
): boolean {
  if (
    !rule.applicability.targets.includes(context.target) ||
    !rule.applicability.environments.includes(context.environment)
  ) {
    return false;
  }

  if (rule.applicability.providers.kind === "include") {
    const providerId = context.document?.provider.id;
    if (
      providerId === undefined ||
      !rule.applicability.providers.providerIds.includes(providerId)
    ) {
      return false;
    }
  }

  if (rule.applicability.catalogs.kind === "include") {
    const catalog = context.document?.catalog;
    if (
      catalog === undefined ||
      !rule.applicability.catalogs.catalogs.some(
        (selector) =>
          selector.catalogId === catalog.id &&
          selector.versions.includes(catalog.version),
      )
    ) {
      return false;
    }
  }

  return rule.input === "envelope" || context.document !== undefined;
}

function isAffectedLocation(
  value: unknown,
): value is ValidationAffectedLocation {
  if (
    !isRecord(value) ||
    typeof value["kind"] !== "string" ||
    !isValidationDocumentPath(value["path"])
  ) {
    return false;
  }

  switch (value["kind"]) {
    case "document":
      return true;
    case "node":
      return nodeIdSchema.safeParse(value["nodeId"]).success;
    case "edge":
      return edgeIdSchema.safeParse(value["edgeId"]).success;
    case "port":
      return (
        edgeIdSchema.safeParse(value["edgeId"]).success &&
        (value["endpoint"] === "source" || value["endpoint"] === "target") &&
        nodeIdSchema.safeParse(value["nodeId"]).success &&
        portTypeSchema.safeParse(value["port"]).success
      );
    case "configuration": {
      const owner = value["owner"];
      return (
        isRecord(owner) &&
        ((owner["kind"] === "node" &&
          nodeIdSchema.safeParse(owner["nodeId"]).success) ||
          (owner["kind"] === "edge" &&
            edgeIdSchema.safeParse(owner["edgeId"]).success)) &&
        (value["key"] === undefined || typeof value["key"] === "string")
      );
    }
    default:
      return false;
  }
}

function isDocumentationReference(
  value: unknown,
): value is ValidationDocumentationReference {
  if (
    !isRecord(value) ||
    !providerIdSchema.safeParse(value["id"]).success ||
    typeof value["title"] !== "string" ||
    value["title"].length === 0
  ) {
    return false;
  }

  return value["kind"] === "cloudmarkup-document"
    ? isValidationDocumentationPath(value["path"])
    : value["kind"] === "external" &&
        typeof value["publisher"] === "string" &&
        value["publisher"].length > 0 &&
        isValidationDocumentationUrl(value["url"]);
}

function normalizeCandidate(
  value: unknown,
): ValidationFindingCandidate | undefined {
  if (
    !isRecord(value) ||
    !providerIdSchema.safeParse(value["code"]).success ||
    !severities.has(value["severity"] as ValidationSeverity) ||
    typeof value["title"] !== "string" ||
    value["title"].length === 0 ||
    typeof value["beginnerExplanation"] !== "string" ||
    value["beginnerExplanation"].length === 0 ||
    typeof value["technicalExplanation"] !== "string" ||
    value["technicalExplanation"].length === 0 ||
    !Array.isArray(value["affected"]) ||
    value["affected"].length === 0 ||
    !value["affected"].every((location) => isAffectedLocation(location)) ||
    !Array.isArray(value["documentationReferences"]) ||
    !value["documentationReferences"].every((reference) =>
      isDocumentationReference(reference),
    )
  ) {
    return undefined;
  }

  try {
    return cloneJsonValue(value) as unknown as ValidationFindingCandidate;
  } catch {
    return undefined;
  }
}

function normalizeAffected(
  affected: readonly ValidationAffectedLocation[],
): readonly ValidationAffectedLocation[] {
  const bySerialization = new Map<string, ValidationAffectedLocation>();
  affected.forEach((location) => {
    bySerialization.set(serializeCanonicalJson(location), location);
  });

  return [...bySerialization.entries()]
    .sort(([left], [right]) => compareUtf16(left, right))
    .map(([, location]) => location);
}

function normalizeDocumentationReferences(
  records: readonly CandidateRecord[],
): readonly ValidationDocumentationReference[] {
  const byId = new Map<string, ValidationDocumentationReference>();
  records.forEach(({ candidate }) => {
    candidate.documentationReferences.forEach((reference) => {
      const existing = byId.get(reference.id);
      if (
        existing === undefined ||
        compareUtf16(
          serializeCanonicalJson(reference),
          serializeCanonicalJson(existing),
        ) < 0
      ) {
        byId.set(reference.id, reference);
      }
    });
  });

  return [...byId.values()].sort((left, right) =>
    compareUtf16(left.id, right.id),
  );
}

function compareCandidateRecords(
  left: CandidateRecord,
  right: CandidateRecord,
): number {
  return (
    severityOrder[left.candidate.severity] -
      severityOrder[right.candidate.severity] ||
    compareUtf16(left.rule.ruleId, right.rule.ruleId) ||
    compareUtf16(left.rule.ruleVersion, right.rule.ruleVersion) ||
    compareUtf16(
      serializeCanonicalJson(left.candidate),
      serializeCanonicalJson(right.candidate),
    )
  );
}

function createDraftFindings(
  records: readonly CandidateRecord[],
): readonly DraftFinding[] {
  const groups = new Map<string, CandidateRecord[]>();

  records.forEach((record) => {
    const affected = normalizeAffected(record.candidate.affected);
    const groupingKey = serializeCanonicalJson({
      code: record.candidate.code,
      affected,
    });
    const current = groups.get(groupingKey) ?? [];
    current.push({
      ...record,
      candidate: {
        ...record.candidate,
        affected,
      },
    });
    groups.set(groupingKey, current);
  });

  return [...groups.entries()].map(([groupingKey, group]) => {
    const sorted = [...group].sort(compareCandidateRecords);
    const winner = sorted[0];
    if (winner === undefined) {
      throw new Error("Validation finding group cannot be empty.");
    }

    const findingId = createValidationFindingId(
      `finding.${hashCanonicalValue(groupingKey).slice("sha256:".length)}`,
    );
    const rulesById = new Map<string, ValidationFindingRuleReference>();
    sorted.forEach(({ rule }) => {
      const existing = rulesById.get(rule.ruleId);
      if (
        existing === undefined ||
        compareUtf16(rule.ruleVersion, existing.ruleVersion) < 0
      ) {
        rulesById.set(rule.ruleId, rule);
      }
    });
    const autoFixOwner = sorted
      .filter(({ candidate }) => candidate.autoFix !== undefined)
      .sort((left, right) =>
        compareUtf16(
          serializeCanonicalJson(left.candidate.autoFix),
          serializeCanonicalJson(right.candidate.autoFix),
        ),
      )[0];

    return {
      findingId,
      code: winner.candidate.code,
      severity: winner.candidate.severity,
      title: winner.candidate.title,
      beginnerExplanation: winner.candidate.beginnerExplanation,
      technicalExplanation: winner.candidate.technicalExplanation,
      affected: winner.candidate.affected,
      documentationReferences: normalizeDocumentationReferences(sorted),
      rules: [...rulesById.values()].sort(
        (left, right) =>
          compareUtf16(left.ruleId, right.ruleId) ||
          compareUtf16(left.ruleVersion, right.ruleVersion),
      ),
      ...(autoFixOwner?.candidate.autoFix === undefined
        ? {}
        : {
            autoFix: {
              command: autoFixOwner.candidate.autoFix,
              ruleId: autoFixOwner.rule.ruleId,
            },
          }),
    };
  });
}

function validatePortInventory(
  inventory: unknown,
  document: ValidationArchitectureDocument | undefined,
): {
  readonly inventory?: ValidationPortInventory;
  readonly diagnostic?: ValidationEngineDiagnostic;
} {
  if (inventory === undefined) {
    return {};
  }

  if (!isRecord(inventory) || !Array.isArray(inventory["nodes"])) {
    return {
      diagnostic: diagnostic(
        "invalid_port_inventory",
        "Port inventory is malformed or does not match the document's pinned provider catalog.",
      ),
    };
  }

  const inventoryNodes = inventory["nodes"];
  const nodeIds = new Set<string>();
  let valid =
    providerIdSchema.safeParse(inventory["providerId"]).success &&
    catalogIdSchema.safeParse(inventory["catalogId"]).success &&
    semanticVersionSchema.safeParse(inventory["catalogVersion"]).success &&
    (inventory["coverage"] === "complete" ||
      inventory["coverage"] === "partial");

  inventoryNodes.forEach((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry["ports"])) {
      valid = false;
      return;
    }

    const nodeId = entry["nodeId"];
    const ports = entry["ports"];
    if (
      !nodeIdSchema.safeParse(nodeId).success ||
      (typeof nodeId === "string" && nodeIds.has(nodeId)) ||
      new Set(ports).size !== ports.length ||
      !ports.every((port) => portTypeSchema.safeParse(port).success)
    ) {
      valid = false;
    }
    if (typeof nodeId === "string") {
      nodeIds.add(nodeId);
    }
  });

  if (
    document !== undefined &&
    (inventory["providerId"] !== document.provider.id ||
      inventory["catalogId"] !== document.catalog.id ||
      inventory["catalogVersion"] !== document.catalog.version)
  ) {
    valid = false;
  }

  if (!valid) {
    return {
      diagnostic: diagnostic(
        "invalid_port_inventory",
        "Port inventory is malformed or does not match the document's pinned provider catalog.",
      ),
    };
  }

  return {
    inventory: deepFreeze(
      cloneJsonValue(inventory) as unknown as ValidationPortInventory,
    ),
  };
}

function validateAutoFixes(
  findings: readonly DraftFinding[],
  document: ValidationArchitectureDocument | undefined,
  diagnostics: ValidationEngineDiagnostic[],
): readonly AutoFixRecord[] {
  if (document === undefined) {
    return [];
  }

  const fixes: AutoFixRecord[] = [];
  findings.forEach((finding) => {
    if (finding.autoFix === undefined) {
      return;
    }

    try {
      const command = parseGraphCommandV1(finding.autoFix.command);
      if (command.kind !== "batch") {
        throw new TypeError("Validation auto-fixes must be command batches.");
      }

      const result = applyGraphCommand(document, command);
      const hashes = getArchitectureDocumentHashes(result.document);
      fixes.push({
        findingId: finding.findingId,
        ruleId: finding.autoFix.ruleId,
        preview: {
          command,
          changes: result.changes,
          resultingDocumentHash: hashes.contentHash,
          resultingVisualHash: hashes.visualHash,
        },
      });
    } catch {
      diagnostics.push(
        diagnostic(
          "auto_fix_validation_failed",
          "A rule-proposed auto-fix was withheld because Graph Command v1 did not accept it.",
          {
            ruleId: finding.autoFix.ruleId,
            findingId: finding.findingId,
          },
        ),
      );
    }
  });

  return fixes;
}

function fixesConflict(
  document: ValidationArchitectureDocument,
  left: AutoFixRecord,
  right: AutoFixRecord,
): boolean {
  try {
    const leftResult = applyGraphCommand(document, left.preview.command);
    applyGraphCommand(leftResult.document, right.preview.command);

    const rightResult = applyGraphCommand(document, right.preview.command);
    applyGraphCommand(rightResult.document, left.preview.command);
    return false;
  } catch {
    return true;
  }
}

function sortFindings(
  findings: readonly DraftFinding[],
): readonly DraftFinding[] {
  return [...findings].sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      compareUtf16(
        left.affected[0]?.path ?? "$",
        right.affected[0]?.path ?? "$",
      ) ||
      compareUtf16(left.rules[0]?.ruleId ?? "", right.rules[0]?.ruleId ?? "") ||
      compareUtf16(left.code, right.code) ||
      compareUtf16(left.findingId, right.findingId),
  );
}

function summaryFor(
  findings: readonly ValidationFinding[],
): Readonly<Record<ValidationSeverity, number>> {
  const summary: Record<ValidationSeverity, number> = {
    error: 0,
    "security-error": 0,
    warning: 0,
    recommendation: 0,
    "educational-note": 0,
    "cost-warning": 0,
  };
  findings.forEach((finding) => {
    summary[finding.severity] += 1;
  });
  return summary;
}

function sortDiagnostics(
  diagnostics: readonly ValidationEngineDiagnostic[],
): readonly ValidationEngineDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      compareUtf16(left.path, right.path) ||
      compareUtf16(left.code, right.code) ||
      compareUtf16(left.ruleId ?? "", right.ruleId ?? "") ||
      compareUtf16(left.findingId ?? "", right.findingId ?? "") ||
      compareUtf16(left.message, right.message),
  );
}

export function executeArchitectureValidationRules(
  request: Omit<ArchitectureValidationRequest, "additionalRules">,
  rules: readonly ValidationRuleV1[],
): ValidationReport {
  const diagnostics: ValidationEngineDiagnostic[] = [];
  const rawDocument = cloneValidationInput(request.document);

  const document = parseValidationDocument(rawDocument);
  if (document === undefined) {
    diagnostics.push(
      diagnostic(
        "document_structure_invalid",
        "The Architecture Document did not pass a supported strict structural schema; document-dependent rules were skipped.",
      ),
    );
  }

  const portInventoryResult = validatePortInventory(
    request.portInventory,
    document,
  );
  if (portInventoryResult.diagnostic !== undefined) {
    diagnostics.push(portInventoryResult.diagnostic);
  }

  const context = deepFreeze({
    rawDocument,
    ...(document === undefined ? {} : { document }),
    target: request.target,
    environment: request.environment,
    ...(portInventoryResult.inventory === undefined
      ? {}
      : { portInventory: portInventoryResult.inventory }),
  } satisfies ValidationRuleContextV1);

  const validRules: ValidationRuleV1[] = [];
  rules.forEach((rule) => {
    if (!isValidRuleDefinition(rule)) {
      diagnostics.push(
        diagnostic(
          "invalid_rule_definition",
          "A validation rule definition was rejected.",
        ),
      );
      return;
    }

    validRules.push(
      defineValidationRuleV1({
        interfaceVersion: rule.interfaceVersion,
        id: rule.id,
        ruleVersion: rule.ruleVersion,
        input: rule.input,
        applicability: rule.applicability,
        evaluate: rule.evaluate,
      }),
    );
  });
  const groupsByRuleId = new Map<string, ValidationRuleV1[]>();
  validRules.forEach((rule) => {
    groupsByRuleId.set(rule.id, [...(groupsByRuleId.get(rule.id) ?? []), rule]);
  });

  const executableRules: ValidationRuleV1[] = [];
  const skippedRuleIds = new Set<ValidationRuleId>();
  [...groupsByRuleId.entries()]
    .sort(([left], [right]) => compareUtf16(left, right))
    .forEach(([, groupedRules]) => {
      const sorted = [...groupedRules].sort((left, right) =>
        compareUtf16(left.ruleVersion, right.ruleVersion),
      );
      const first = sorted[0];
      if (first === undefined) {
        return;
      }
      if (sorted.length > 1) {
        diagnostics.push(
          diagnostic(
            "duplicate_rule_id",
            "Every active validation rule must have a unique stable rule ID.",
            { ruleId: first.id },
          ),
        );
        skippedRuleIds.add(first.id);
        return;
      }
      executableRules.push(first);
    });

  const candidates: CandidateRecord[] = [];
  const executedRules: ValidationFindingRuleReference[] = [];
  executableRules
    .sort(
      (left, right) =>
        compareUtf16(left.id, right.id) ||
        compareUtf16(left.ruleVersion, right.ruleVersion),
    )
    .forEach((rule) => {
      if (!ruleApplies(rule, context)) {
        skippedRuleIds.add(rule.id);
        return;
      }

      const ruleReference = {
        ruleId: rule.id,
        ruleVersion: rule.ruleVersion,
      };
      executedRules.push(ruleReference);

      try {
        const output = rule.evaluate(context);
        if (!Array.isArray(output)) {
          throw new TypeError("Validation rule output must be an array.");
        }
        output.forEach((candidate) => {
          const normalized = normalizeCandidate(candidate);
          if (normalized === undefined) {
            diagnostics.push(
              diagnostic(
                "invalid_rule_output",
                "A validation rule finding was rejected because its shape was invalid.",
                { ruleId: rule.id },
              ),
            );
            return;
          }
          candidates.push({
            candidate: normalized,
            rule: ruleReference,
          });
        });
      } catch {
        diagnostics.push(
          diagnostic(
            "rule_execution_failed",
            "A validation rule failed internally; other rules continued and this report is incomplete.",
            { ruleId: rule.id },
          ),
        );
      }
    });

  const draftFindings = sortFindings(createDraftFindings(candidates));
  const fixes = validateAutoFixes(draftFindings, document, diagnostics);
  const conflictsByFindingId = new Map<string, Set<ValidationFindingId>>();
  if (document !== undefined) {
    fixes.forEach((left, leftIndex) => {
      fixes.slice(leftIndex + 1).forEach((right) => {
        if (!fixesConflict(document, left, right)) {
          return;
        }
        const leftConflicts =
          conflictsByFindingId.get(left.findingId) ??
          new Set<ValidationFindingId>();
        const rightConflicts =
          conflictsByFindingId.get(right.findingId) ??
          new Set<ValidationFindingId>();
        leftConflicts.add(right.findingId);
        rightConflicts.add(left.findingId);
        conflictsByFindingId.set(left.findingId, leftConflicts);
        conflictsByFindingId.set(right.findingId, rightConflicts);
      });
    });
  }
  const fixesByFindingId = new Map(
    fixes.map((fix) => [fix.findingId, fix] as const),
  );

  const findings: ValidationFinding[] = draftFindings.map((finding) => {
    const fix = fixesByFindingId.get(finding.findingId);
    return {
      findingId: finding.findingId,
      code: finding.code,
      severity: finding.severity,
      title: finding.title,
      beginnerExplanation: finding.beginnerExplanation,
      technicalExplanation: finding.technicalExplanation,
      affected: finding.affected,
      documentationReferences: finding.documentationReferences,
      rules: finding.rules,
      ...(fix === undefined
        ? {}
        : {
            autoFix: {
              ...fix.preview,
              conflictsWithFindingIds: [
                ...(conflictsByFindingId.get(finding.findingId) ?? []),
              ].sort(compareUtf16),
            },
          }),
    };
  });

  const sortedDiagnostics = sortDiagnostics(diagnostics);

  return deepFreeze({
    reportVersion: VALIDATION_REPORT_VERSION,
    engineVersion: VALIDATION_ENGINE_VERSION,
    documentHash: safeInputHash(rawDocument, document),
    evaluationStatus:
      sortedDiagnostics.length === 0 ? "complete" : "incomplete",
    target: request.target,
    environment: request.environment,
    ...(document === undefined
      ? {}
      : {
          provider: document.provider,
          catalog: document.catalog,
        }),
    findings,
    diagnostics: sortedDiagnostics,
    executedRules,
    skippedRuleIds: [...skippedRuleIds].sort(compareUtf16),
    summary: summaryFor(findings),
  });
}

export function validateArchitectureDocumentWithRules(
  request: ArchitectureValidationRequest,
): ValidationReport {
  const rejectedRuleIds: ValidationRuleId[] = [];
  const extensionRules = (request.additionalRules ?? []).filter((rule) => {
    const ruleId: unknown = isRecord(rule) ? rule.id : undefined;
    if (
      typeof ruleId !== "string" ||
      (ruleId !== "cloudmarkup.core" &&
        !ruleId.startsWith("cloudmarkup.core.")) ||
      !providerIdSchema.safeParse(ruleId).success
    ) {
      return true;
    }
    rejectedRuleIds.push(createValidationRuleId(ruleId));
    return false;
  });
  const report = executeArchitectureValidationRules(request, [
    ...providerNeutralValidationRules,
    ...extensionRules,
  ]);

  if (rejectedRuleIds.length === 0) {
    return report;
  }

  return deepFreeze({
    ...report,
    evaluationStatus: "incomplete" as const,
    diagnostics: sortDiagnostics([
      ...report.diagnostics,
      ...rejectedRuleIds.map((ruleId) =>
        diagnostic(
          "reserved_rule_id",
          "Extension rules may not register IDs in the reserved cloudmarkup.core namespace.",
          { ruleId },
        ),
      ),
    ]),
  });
}
