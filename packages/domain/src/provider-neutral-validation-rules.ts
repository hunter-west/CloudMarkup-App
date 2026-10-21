import { generatedResourceProvenanceSchema } from "@cloudmarkup/schemas";

import {
  validateArchitectureDocumentSemantics,
  type ArchitectureDocumentSemanticIssue,
  type ArchitectureDocumentSemanticIssueCode,
} from "./semantic-validation.js";
import {
  VALIDATION_ENVIRONMENTS,
  VALIDATION_TARGETS,
  createValidationDocumentPath,
  createValidationDocumentationId,
  createValidationDocumentationPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  type ValidationAffectedLocation,
  type ValidationArchitectureDocument,
  type ValidationDocumentationReference,
  type ValidationFindingCandidate,
  type ValidationRuleApplicabilityV1,
  type ValidationRuleContextV1,
  type ValidationRuleV1,
} from "./validation-contract.js";

const allApplicability: ValidationRuleApplicabilityV1 = {
  providers: { kind: "all" },
  catalogs: { kind: "all" },
  targets: VALIDATION_TARGETS,
  environments: VALIDATION_ENVIRONMENTS,
};

const domainInvariantsReference: ValidationDocumentationReference = {
  kind: "cloudmarkup-document",
  id: createValidationDocumentationId(
    "cloudmarkup.docs.architecture.domain-invariants",
  ),
  title: "CloudMarkup domain invariants",
  path: createValidationDocumentationPath(
    "docs/architecture/DOMAIN_MODEL.md#invariants",
  ),
};

const versioningReference: ValidationDocumentationReference = {
  kind: "cloudmarkup-document",
  id: createValidationDocumentationId(
    "cloudmarkup.docs.architecture.versioning",
  ),
  title: "CloudMarkup versioning and migration",
  path: createValidationDocumentationPath(
    "docs/architecture/DOMAIN_MODEL.md#versioning-and-migration",
  ),
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function locationForSemanticIssue(
  document: ValidationArchitectureDocument,
  issue: ArchitectureDocumentSemanticIssue,
): ValidationAffectedLocation {
  const path = createValidationDocumentPath(issue.path);
  const nodeMatch = /^\$\.nodes\[(\d+)\]/u.exec(issue.path);
  if (nodeMatch !== null) {
    const index = Number(nodeMatch[1]);
    const node = document.nodes[index];
    if (node !== undefined) {
      if (issue.path.includes(".semantic.configuration")) {
        const keyMarker = ".values.";
        const keyIndex = issue.path.indexOf(keyMarker);
        return {
          kind: "configuration",
          owner: { kind: "node", nodeId: node.id },
          ...(keyIndex < 0
            ? {}
            : { key: issue.path.slice(keyIndex + keyMarker.length) }),
          path,
        };
      }

      return {
        kind: "node",
        nodeId: node.id,
        path,
      };
    }
  }

  const edgeMatch = /^\$\.edges\[(\d+)\]/u.exec(issue.path);
  if (edgeMatch !== null) {
    const index = Number(edgeMatch[1]);
    const edge = document.edges[index];
    if (edge !== undefined) {
      if (issue.path.includes(".semantic.configuration")) {
        const keyMarker = ".values.";
        const keyIndex = issue.path.indexOf(keyMarker);
        return {
          kind: "configuration",
          owner: { kind: "edge", edgeId: edge.id },
          ...(keyIndex < 0
            ? {}
            : { key: issue.path.slice(keyIndex + keyMarker.length) }),
          path,
        };
      }

      return {
        kind: "edge",
        edgeId: edge.id,
        path,
      };
    }
  }

  return {
    kind: "document",
    path,
  };
}

interface SemanticRuleText {
  readonly title: string;
  readonly beginnerExplanation: string;
}

function semanticCandidates(
  context: ValidationRuleContextV1,
  codes: ReadonlySet<ArchitectureDocumentSemanticIssueCode>,
  text: SemanticRuleText,
  severity: ValidationFindingCandidate["severity"] = "error",
): readonly ValidationFindingCandidate[] {
  if (context.document === undefined) {
    return [];
  }
  const document = context.document;

  return validateArchitectureDocumentSemantics(document)
    .filter((issue) => codes.has(issue.code))
    .map((issue) => ({
      code: createValidationFindingCode(
        `cloudmarkup.validation.${issue.code.replaceAll("_", "-")}`,
      ),
      severity,
      title: text.title,
      beginnerExplanation: text.beginnerExplanation,
      technicalExplanation: issue.message,
      affected: [locationForSemanticIssue(document, issue)],
      documentationReferences: [domainInvariantsReference],
    }));
}

const duplicateIssueCodes = new Set<ArchitectureDocumentSemanticIssueCode>([
  "duplicate_application_contract_identity",
  "duplicate_assumption_id",
  "duplicate_deployment_key",
  "duplicate_edge_id",
  "duplicate_external_resource_id",
  "duplicate_node_id",
  "duplicate_output_id",
  "duplicate_output_key",
  "duplicate_requirement_id",
  "duplicate_variable_id",
  "duplicate_variable_key",
  "duplicate_workload_downstream_binding_id",
  "duplicate_workload_downstream_edge_binding",
  "duplicate_workload_environment_binding_id",
  "duplicate_workload_environment_name",
  "duplicate_workload_extension_id",
  "duplicate_workload_id",
  "duplicate_workload_operation_id",
  "duplicate_workload_owner",
  "duplicate_workload_requirement_reference",
  "duplicate_workload_trigger_binding_id",
  "duplicate_workload_trigger_edge_binding",
]);

const brokenReferenceIssueCodes =
  new Set<ArchitectureDocumentSemanticIssueCode>([
    "broken_configuration_node_reference",
    "broken_edge_source_reference",
    "broken_edge_target_reference",
    "broken_parent_reference",
    "broken_workload_dispatcher_operation_reference",
    "broken_workload_downstream_edge_reference",
    "broken_workload_downstream_operation_reference",
    "broken_workload_environment_node_reference",
    "broken_workload_environment_variable_reference",
    "broken_workload_owner_reference",
    "broken_workload_requirement_reference",
    "broken_workload_trigger_edge_reference",
    "broken_workload_trigger_operation_reference",
    "invalid_workload_downstream_edge_ownership",
    "invalid_workload_dispatch_mode_for_implementation",
    "invalid_workload_trigger_edge_ownership",
  ]);

const parentCycleIssueCodes = new Set<ArchitectureDocumentSemanticIssueCode>([
  "parent_cycle",
  "self_parent",
]);

const provenanceIssueCodes = new Set<ArchitectureDocumentSemanticIssueCode>([
  "broken_generated_edge_reference",
  "broken_generated_node_reference",
  "duplicate_generated_edge_reference",
  "duplicate_generated_node_reference",
  "self_generated_edge_reference",
  "self_generated_node_reference",
]);

const variableOutputIssueCodes = new Set<ArchitectureDocumentSemanticIssueCode>(
  [
    "broken_configuration_variable_reference",
    "broken_output_node_reference",
    "broken_output_variable_reference",
    "invalid_variable_default",
  ],
);

const applicationContractIssueCodes =
  new Set<ArchitectureDocumentSemanticIssueCode>([
    "application_contract_digest_mismatch",
    "application_contract_kind_mismatch",
    "broken_application_contract_reference",
  ]);

const externalResourceIssueCodes =
  new Set<ArchitectureDocumentSemanticIssueCode>([
    "broken_external_resource_node_reference",
  ]);

const workloadV2ReferenceIssueCodes =
  new Set<ArchitectureDocumentSemanticIssueCode>([
    "broken_workload_v2_edge_reference",
    "broken_workload_v2_operation_reference",
  ]);

const workloadAiAuthorityIssueCodes =
  new Set<ArchitectureDocumentSemanticIssueCode>([
    "broken_workload_extension_reference",
    "invalid_workload_model_compatibility",
    "missing_workload_model_compatibility",
  ]);

export const unsupportedDocumentVersionRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.document-version",
  ruleVersion: "1.0.0",
  input: "envelope",
  applicability: allApplicability,
  evaluate: (context) => {
    if (
      isRecord(context.rawDocument) &&
      context.rawDocument["kind"] === "cloudmarkup.architecture-document" &&
      (context.rawDocument["schemaVersion"] === 1 ||
        context.rawDocument["schemaVersion"] === 2 ||
        context.rawDocument["schemaVersion"] === 3)
    ) {
      return [];
    }

    return [
      {
        code: createValidationFindingCode(
          "cloudmarkup.validation.unsupported-document-version",
        ),
        severity: "error",
        title: "Unsupported Architecture Document version",
        beginnerExplanation:
          "This architecture uses a document version that CloudMarkup cannot validate safely.",
        technicalExplanation:
          "The validation engine supports Architecture Document schema versions 1, 2, and 3 and does not reinterpret unknown versions.",
        affected: [
          {
            kind: "document",
            path: createValidationDocumentPath("$.schemaVersion"),
          },
        ],
        documentationReferences: [versioningReference],
      },
    ];
  },
});

export const applicationContractIntegrityRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.application-contract-integrity",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, applicationContractIssueCodes, {
      title: "Application contract reference is invalid",
      beginnerExplanation:
        "An application behavior points to a contract that is missing or does not match the reviewed contract content.",
    }),
});

export const duplicateIdentityRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.duplicate-identity",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, duplicateIssueCodes, {
      title: "Architecture identity is duplicated",
      beginnerExplanation:
        "Two architecture items use an identity or deployment key that must be unique.",
    }),
});

export const brokenReferenceRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.broken-reference",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, brokenReferenceIssueCodes, {
      title: "Architecture reference is broken",
      beginnerExplanation:
        "An architecture item points to another item that is not present.",
    }),
});

export const externalResourceReferenceRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.external-resource-reference",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, externalResourceIssueCodes, {
      title: "External resource reference is invalid",
      beginnerExplanation:
        "An external resource points to an architecture item that is not present.",
    }),
});

export const workloadV2ReferenceRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.workload-v2-reference",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, workloadV2ReferenceIssueCodes, {
      title: "Workload behavior reference is invalid",
      beginnerExplanation:
        "A workload behavior points to an operation or connection that is not present.",
    }),
});

export const workloadAiAuthorityRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.workload-ai-authority",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(
      context,
      workloadAiAuthorityIssueCodes,
      {
        title: "AI-assisted workload authority is incomplete",
        beginnerExplanation:
          "An AI-assisted workload is missing its reviewed extension or ModelGateway compatibility evidence.",
      },
      "security-error",
    ),
});

export const invalidParentCycleRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.parent-cycle",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, parentCycleIssueCodes, {
      title: "Parent relationship forms an invalid cycle",
      beginnerExplanation:
        "A resource cannot contain itself, directly or through a chain of parents.",
    }),
});

function rawMalformedProvenanceCandidates(
  rawDocument: unknown,
): readonly ValidationFindingCandidate[] {
  if (!isRecord(rawDocument)) {
    return [];
  }

  const candidates: ValidationFindingCandidate[] = [];
  (["nodes", "edges"] as const).forEach((collectionName) => {
    const collection = rawDocument[collectionName];
    if (!Array.isArray(collection)) {
      return;
    }

    collection.forEach((element, index) => {
      if (!isRecord(element)) {
        return;
      }
      const semantic = element["semantic"];
      if (!isRecord(semantic)) {
        return;
      }
      const lifecycle = semantic["lifecycle"];
      if (
        !isRecord(lifecycle) ||
        (lifecycle["ownership"] !== "generated" &&
          lifecycle["ownership"] !== "adopted")
      ) {
        return;
      }

      if (
        generatedResourceProvenanceSchema.safeParse(lifecycle["provenance"])
          .success
      ) {
        return;
      }

      candidates.push({
        code: createValidationFindingCode(
          "cloudmarkup.validation.malformed-operation-provenance",
        ),
        severity: "security-error",
        title: "Generated-resource provenance is malformed",
        beginnerExplanation:
          "CloudMarkup cannot safely explain or manage this generated resource.",
        technicalExplanation:
          "Generated and adopted resources require structurally valid, versioned operation provenance.",
        affected: [
          {
            kind: "document",
            path: createValidationDocumentPath(
              `$.${collectionName}[${String(index)}].semantic.lifecycle.provenance`,
            ),
          },
        ],
        documentationReferences: [domainInvariantsReference],
      });
    });
  });

  return candidates;
}

export const malformedOperationProvenanceRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.operation-provenance",
  ruleVersion: "1.0.0",
  input: "envelope",
  applicability: allApplicability,
  evaluate: (context) =>
    context.document === undefined
      ? rawMalformedProvenanceCandidates(context.rawDocument)
      : semanticCandidates(
          context,
          provenanceIssueCodes,
          {
            title: "Generated-resource provenance is invalid",
            beginnerExplanation:
              "CloudMarkup cannot safely explain or manage this generated resource.",
          },
          "security-error",
        ),
});

export const invalidVariableOutputReferenceRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.variable-output-reference",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) =>
    semanticCandidates(context, variableOutputIssueCodes, {
      title: "Variable or output reference is invalid",
      beginnerExplanation:
        "A configuration value or output points to unavailable or incompatible data.",
    }),
});

export const missingPortRule = defineValidationRuleV1({
  interfaceVersion: 1,
  id: "cloudmarkup.core.validation.missing-port",
  ruleVersion: "1.0.0",
  input: "architecture-document",
  applicability: allApplicability,
  evaluate: (context) => {
    if (context.document === undefined || context.portInventory === undefined) {
      return [];
    }
    const portInventory = context.portInventory;

    const portsByNodeId = new Map(
      portInventory.nodes.map((entry) => [entry.nodeId, new Set(entry.ports)]),
    );
    const candidates: ValidationFindingCandidate[] = [];

    context.document.edges.forEach((edge, edgeIndex) => {
      (["source", "target"] as const).forEach((endpointName) => {
        const endpoint = edge.semantic[endpointName];
        const ports = portsByNodeId.get(endpoint.nodeId);
        if (
          (ports === undefined && portInventory.coverage === "partial") ||
          ports?.has(endpoint.port)
        ) {
          return;
        }

        candidates.push({
          code: createValidationFindingCode(
            "cloudmarkup.validation.missing-port",
          ),
          severity: "error",
          title: "Edge references an unavailable port",
          beginnerExplanation:
            "This connection uses a port that is not available on the selected resource.",
          technicalExplanation:
            "The edge endpoint port is absent from the supplied version-bound provider-neutral port inventory.",
          affected: [
            {
              kind: "port",
              edgeId: edge.id,
              endpoint: endpointName,
              nodeId: endpoint.nodeId,
              port: endpoint.port,
              path: createValidationDocumentPath(
                `$.edges[${String(edgeIndex)}].semantic.${endpointName}.port`,
              ),
            },
          ],
          documentationReferences: [domainInvariantsReference],
        });
      });
    });

    return candidates;
  },
});

export const providerNeutralValidationRules: readonly ValidationRuleV1[] =
  Object.freeze([
    applicationContractIntegrityRule,
    brokenReferenceRule,
    duplicateIdentityRule,
    externalResourceReferenceRule,
    invalidParentCycleRule,
    invalidVariableOutputReferenceRule,
    malformedOperationProvenanceRule,
    missingPortRule,
    unsupportedDocumentVersionRule,
    workloadAiAuthorityRule,
    workloadV2ReferenceRule,
  ]);
