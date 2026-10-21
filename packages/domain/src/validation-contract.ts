import {
  environmentTypeSchema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  type ArchitectureDocumentV2,
  type ArchitectureDocumentV3,
  type CatalogId,
  type EdgeId,
  type EnvironmentType,
  type GraphCommandBatchV1,
  type NodeId,
  type PortType,
  type ProviderId,
  type SemanticVersion,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type { GraphChangeSummary } from "./graph-commands.js";

export type ValidationArchitectureDocument =
  ArchitectureDocumentV2 | ArchitectureDocumentV3;

declare const validationRuleIdBrand: unique symbol;
declare const validationFindingCodeBrand: unique symbol;
declare const validationFindingIdBrand: unique symbol;
declare const validationDocumentPathBrand: unique symbol;
declare const validationDocumentationIdBrand: unique symbol;
declare const validationDocumentationPathBrand: unique symbol;
declare const validationDocumentationUrlBrand: unique symbol;

export const VALIDATION_RULE_INTERFACE_VERSION = 1 as const;
export const VALIDATION_REPORT_VERSION = 1 as const;
export const VALIDATION_ENGINE_VERSION = "1.0.0" as SemanticVersion;
export const VALIDATION_SEVERITIES = Object.freeze([
  "error",
  "security-error",
  "warning",
  "recommendation",
  "educational-note",
  "cost-warning",
] as const);
export const VALIDATION_TARGETS = Object.freeze([
  "draft",
  "revision",
  "compilation",
] as const);
export const VALIDATION_ENVIRONMENTS = Object.freeze([
  ...environmentTypeSchema.options,
  "unknown",
] as const satisfies readonly (EnvironmentType | "unknown")[]);

export type ValidationRuleId = string & {
  readonly [validationRuleIdBrand]: "ValidationRuleId";
};
export type ValidationFindingCode = string & {
  readonly [validationFindingCodeBrand]: "ValidationFindingCode";
};
export type ValidationFindingId = string & {
  readonly [validationFindingIdBrand]: "ValidationFindingId";
};
export type ValidationDocumentPath = string & {
  readonly [validationDocumentPathBrand]: "ValidationDocumentPath";
};
export type ValidationDocumentationId = string & {
  readonly [validationDocumentationIdBrand]: "ValidationDocumentationId";
};
export type ValidationDocumentationPath = string & {
  readonly [validationDocumentationPathBrand]: "ValidationDocumentationPath";
};
export type ValidationDocumentationUrl = string & {
  readonly [validationDocumentationUrlBrand]: "ValidationDocumentationUrl";
};

export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export type ValidationTarget = (typeof VALIDATION_TARGETS)[number];

export type ValidationEnvironment = (typeof VALIDATION_ENVIRONMENTS)[number];

export type ValidationProviderSelector =
  | { readonly kind: "all" }
  | {
      readonly kind: "include";
      readonly providerIds: readonly ProviderId[];
    };

export type ValidationCatalogSelector =
  | { readonly kind: "all" }
  | {
      readonly kind: "include";
      readonly catalogs: readonly {
        readonly catalogId: CatalogId;
        readonly versions: readonly SemanticVersion[];
      }[];
    };

export interface ValidationRuleApplicabilityV1 {
  readonly providers: ValidationProviderSelector;
  readonly catalogs: ValidationCatalogSelector;
  readonly targets: readonly ValidationTarget[];
  readonly environments: readonly ValidationEnvironment[];
}

export type ValidationDocumentationReference =
  | {
      readonly kind: "cloudmarkup-document";
      readonly id: ValidationDocumentationId;
      readonly title: string;
      readonly path: ValidationDocumentationPath;
    }
  | {
      readonly kind: "external";
      readonly id: ValidationDocumentationId;
      readonly title: string;
      readonly publisher: string;
      readonly url: ValidationDocumentationUrl;
    };

export type ValidationAffectedLocation =
  | {
      readonly kind: "document";
      readonly path: ValidationDocumentPath;
    }
  | {
      readonly kind: "node";
      readonly nodeId: NodeId;
      readonly path: ValidationDocumentPath;
    }
  | {
      readonly kind: "edge";
      readonly edgeId: EdgeId;
      readonly path: ValidationDocumentPath;
    }
  | {
      readonly kind: "port";
      readonly edgeId: EdgeId;
      readonly endpoint: "source" | "target";
      readonly nodeId: NodeId;
      readonly port: PortType;
      readonly path: ValidationDocumentPath;
    }
  | {
      readonly kind: "configuration";
      readonly owner:
        | { readonly kind: "node"; readonly nodeId: NodeId }
        | { readonly kind: "edge"; readonly edgeId: EdgeId };
      readonly key?: string;
      readonly path: ValidationDocumentPath;
    };

export interface ValidationPortInventoryEntry {
  readonly nodeId: NodeId;
  readonly ports: readonly PortType[];
}

export interface ValidationPortInventory {
  readonly providerId: ProviderId;
  readonly catalogId: CatalogId;
  readonly catalogVersion: SemanticVersion;
  readonly coverage: "complete" | "partial";
  readonly nodes: readonly ValidationPortInventoryEntry[];
}

export interface ValidationFindingCandidate {
  readonly code: ValidationFindingCode;
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly beginnerExplanation: string;
  readonly technicalExplanation: string;
  readonly affected: readonly ValidationAffectedLocation[];
  readonly documentationReferences: readonly ValidationDocumentationReference[];
  readonly autoFix?: GraphCommandBatchV1;
}

export interface ValidationRuleContextV1 {
  readonly rawDocument: unknown;
  readonly document?: ValidationArchitectureDocument;
  readonly target: ValidationTarget;
  readonly environment: ValidationEnvironment;
  readonly portInventory?: ValidationPortInventory;
}

export interface ValidationRuleV1 {
  readonly interfaceVersion: typeof VALIDATION_RULE_INTERFACE_VERSION;
  readonly id: ValidationRuleId;
  readonly ruleVersion: SemanticVersion;
  readonly input: "envelope" | "architecture-document";
  readonly applicability: ValidationRuleApplicabilityV1;
  readonly evaluate: (
    context: ValidationRuleContextV1,
  ) => readonly ValidationFindingCandidate[];
}

export interface ValidationFindingRuleReference {
  readonly ruleId: ValidationRuleId;
  readonly ruleVersion: SemanticVersion;
}

export interface ValidatedAutoFixPreview {
  readonly command: GraphCommandBatchV1;
  readonly changes: readonly GraphChangeSummary[];
  readonly resultingDocumentHash: Sha256Digest;
  readonly resultingVisualHash: Sha256Digest;
  readonly conflictsWithFindingIds: readonly ValidationFindingId[];
}

export interface ValidationFinding {
  readonly findingId: ValidationFindingId;
  readonly code: ValidationFindingCode;
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly beginnerExplanation: string;
  readonly technicalExplanation: string;
  readonly affected: readonly ValidationAffectedLocation[];
  readonly documentationReferences: readonly ValidationDocumentationReference[];
  readonly rules: readonly ValidationFindingRuleReference[];
  readonly autoFix?: ValidatedAutoFixPreview;
}

export type ValidationEngineDiagnosticCode =
  | "auto_fix_validation_failed"
  | "document_structure_invalid"
  | "duplicate_rule_id"
  | "invalid_port_inventory"
  | "invalid_rule_definition"
  | "invalid_rule_output"
  | "reserved_rule_id"
  | "rule_execution_failed";

export interface ValidationEngineDiagnostic {
  readonly code: ValidationEngineDiagnosticCode;
  readonly message: string;
  readonly path: ValidationDocumentPath;
  readonly ruleId?: ValidationRuleId;
  readonly findingId?: ValidationFindingId;
}

export interface ValidationReport {
  readonly reportVersion: typeof VALIDATION_REPORT_VERSION;
  readonly engineVersion: SemanticVersion;
  readonly documentHash: Sha256Digest;
  readonly evaluationStatus: "complete" | "incomplete";
  readonly target: ValidationTarget;
  readonly environment: ValidationEnvironment;
  readonly provider?: {
    readonly id: ProviderId;
    readonly region: ValidationArchitectureDocument["provider"]["region"];
  };
  readonly catalog?: ValidationArchitectureDocument["catalog"];
  readonly findings: readonly ValidationFinding[];
  readonly diagnostics: readonly ValidationEngineDiagnostic[];
  readonly executedRules: readonly ValidationFindingRuleReference[];
  readonly skippedRuleIds: readonly ValidationRuleId[];
  readonly summary: Readonly<Record<ValidationSeverity, number>>;
}

export interface ArchitectureValidationRequest {
  readonly document: unknown;
  readonly target: ValidationTarget;
  readonly environment: ValidationEnvironment;
  readonly portInventory?: ValidationPortInventory;
  readonly additionalRules?: readonly ValidationRuleV1[];
}

export function isValidationDocumentPath(
  value: unknown,
): value is ValidationDocumentPath {
  return typeof value === "string" && /^\$(?:$|\.|\[)/u.test(value);
}

export function isValidationDocumentationPath(
  value: unknown,
): value is ValidationDocumentationPath {
  if (
    typeof value !== "string" ||
    !/^docs\/[A-Za-z0-9_./-]+(?:#[A-Za-z0-9_.-]+)?$/u.test(value)
  ) {
    return false;
  }

  const path = value.split("#", 1)[0];
  return (
    path
      ?.split("/")
      .every(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      ) ?? false
  );
}

export function isValidationDocumentationUrl(
  value: unknown,
): value is ValidationDocumentationUrl {
  return typeof value === "string" && /^https:\/\/[^\s]+$/u.test(value);
}

export function createValidationRuleId(value: string): ValidationRuleId {
  return namespacedIdentifierSchema.parse(value) as unknown as ValidationRuleId;
}

export function createValidationFindingCode(
  value: string,
): ValidationFindingCode {
  return namespacedIdentifierSchema.parse(
    value,
  ) as unknown as ValidationFindingCode;
}

export function createValidationDocumentPath(
  value: string,
): ValidationDocumentPath {
  if (!isValidationDocumentPath(value)) {
    throw new TypeError("Validation document paths must be rooted at '$'.");
  }

  return value;
}

export function createValidationDocumentationId(
  value: string,
): ValidationDocumentationId {
  return namespacedIdentifierSchema.parse(
    value,
  ) as unknown as ValidationDocumentationId;
}

export function createValidationDocumentationPath(
  value: string,
): ValidationDocumentationPath {
  if (!isValidationDocumentationPath(value)) {
    throw new TypeError(
      "CloudMarkup documentation references must use a docs/ path.",
    );
  }

  return value;
}

export function createValidationDocumentationUrl(
  value: string,
): ValidationDocumentationUrl {
  if (!isValidationDocumentationUrl(value)) {
    throw new TypeError("External documentation references must use HTTPS.");
  }

  return value;
}

export function createValidationFindingId(value: string): ValidationFindingId {
  if (!/^finding\.[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(
      "Validation finding IDs must contain a lowercase SHA-256 digest.",
    );
  }

  return value as ValidationFindingId;
}

type ValidationRuleV1Definition = Omit<
  ValidationRuleV1,
  "id" | "interfaceVersion" | "ruleVersion"
> & {
  readonly id: string;
  readonly interfaceVersion: number;
  readonly ruleVersion: string;
};

function freezeValidationApplicability(
  applicability: ValidationRuleApplicabilityV1,
): ValidationRuleApplicabilityV1 {
  const providers: ValidationProviderSelector =
    applicability.providers.kind === "all"
      ? Object.freeze({ kind: "all" })
      : Object.freeze({
          kind: "include",
          providerIds: Object.freeze([...applicability.providers.providerIds]),
        });
  const catalogs: ValidationCatalogSelector =
    applicability.catalogs.kind === "all"
      ? Object.freeze({ kind: "all" })
      : Object.freeze({
          kind: "include",
          catalogs: Object.freeze(
            applicability.catalogs.catalogs.map((catalog) =>
              Object.freeze({
                catalogId: catalog.catalogId,
                versions: Object.freeze([...catalog.versions]),
              }),
            ),
          ),
        });

  return Object.freeze({
    providers,
    catalogs,
    targets: Object.freeze([...applicability.targets]),
    environments: Object.freeze([...applicability.environments]),
  });
}

export function defineValidationRuleV1(
  definition: ValidationRuleV1Definition,
): ValidationRuleV1 {
  if (definition.interfaceVersion !== VALIDATION_RULE_INTERFACE_VERSION) {
    throw new TypeError("Validation rule interface version is unsupported.");
  }

  return Object.freeze({
    ...definition,
    interfaceVersion: VALIDATION_RULE_INTERFACE_VERSION,
    id: createValidationRuleId(definition.id),
    ruleVersion: semanticVersionSchema.parse(definition.ruleVersion),
    applicability: freezeValidationApplicability(definition.applicability),
  });
}
