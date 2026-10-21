import {
  executeArchitectureValidationRules,
  getApplicationContractRecordContentHash,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { inspectModelValueForSecretCandidatesV1 } from "@cloudmarkup/model-gateway";
import { resolveAwsModelCatalogV1 } from "@cloudmarkup/provider-aws";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import {
  isReviewedLiteralConfigurationPropertyV1,
  type ProviderServiceConfigurationV1,
} from "@cloudmarkup/provider-sdk";
import {
  applicationContractRecordV1Schema,
  applicationContractReferenceV1Schema,
  applicationTestCaseContractV1Schema,
  architectureDocumentV3Schema,
  authContractV1Schema,
  behaviorOperationContractV1Schema,
  betaInfrastructureSelectedIssueV1Schema,
  dataEntityContractV1Schema,
  digestCanonicalValue,
  eventMessageContractV1Schema,
  httpApiContractV1Schema,
  nodeParentV1Schema,
  sha256DigestSchema,
  workloadContractReferenceV1Schema,
  workloadV2Schema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { aiCanvasContextSchema } from "./ai-canvas-context.js";

const text = z.string().min(1).max(512);
const reviewedLiteral = z.union([
  z.string().max(512),
  z.number(),
  z.boolean(),
  z.array(z.string().max(512)).max(128),
  z.array(z.number()).max(128),
]);
const reference = z
  .object({
    property: text,
    nodeId: text,
    attribute: text,
    resolution: z.enum(["included", "unresolved"]),
  })
  .strict();
const configuration = {
  schemaId: text,
  schemaVersion: text,
  configuration: z.record(z.string().max(80), reviewedLiteral),
  references: z.array(reference).max(100),
  omittedConfigurationKeys: z.array(z.string().max(80)).max(100),
};
const environment = z
  .object({
    id: text,
    name: text,
    source: z.union([
      z
        .object({
          kind: z.literal("node-attribute-reference"),
          nodeId: text,
          attribute: text,
          resolution: z.enum(["included", "unresolved"]),
        })
        .strict(),
      z.object({ kind: z.literal("external-runtime-binding") }).strict(),
    ]),
  })
  .strict();
const workload = workloadV2Schema
  .omit({ environment: true, provenance: true })
  .extend({
    operations: workloadV2Schema.shape.operations.max(16),
    environment: z.array(environment).max(32),
  })
  .strict();
const contractData = z.union([
  httpApiContractV1Schema.omit({ provenance: true }),
  eventMessageContractV1Schema.omit({ provenance: true }),
  dataEntityContractV1Schema.omit({ provenance: true }),
  authContractV1Schema.omit({ provenance: true }),
  behaviorOperationContractV1Schema.omit({ provenance: true }),
  applicationTestCaseContractV1Schema.omit({ provenance: true }),
]);

/** New strict read contract. Old context-v2 producers and readers are untouched. */
export const aiSemanticContextV3Schema = z
  .object({
    contextVersion: z.literal(3),
    producerVersion: z.literal("reviewed-semantic-v1"),
    semanticDigest: sha256DigestSchema,
    catalog: architectureDocumentV3Schema.shape.catalog,
    region: z.string().max(64),
    resources: z
      .array(
        z
          .object({
            nodeId: text,
            deploymentKey: text,
            sourcePath: text,
            serviceType: text,
            definitionVersion: text,
            resourceType: text,
            label: text,
            parentNodeId: text.nullable(),
            parent: nodeParentV1Schema.nullable(),
            ownership: z.enum(["user", "generated", "adopted"]),
            editable: z.boolean(),
            ...configuration,
          })
          .strict(),
      )
      .max(100),
    connections: z
      .array(
        z
          .object({
            edgeId: text,
            sourcePath: text,
            ruleId: text,
            ruleVersion: text,
            sourceNodeId: text,
            sourcePort: text,
            targetNodeId: text,
            targetPort: text,
            relationshipType: text,
            category: text,
            ownership: z.enum(["user", "generated", "adopted"]),
            ...configuration,
          })
          .strict(),
      )
      .max(1000),
    workloads: z.array(workload).max(8),
    applicationContracts: z
      .array(
        z
          .object({
            digest: sha256DigestSchema,
            projectionDigest: sha256DigestSchema,
            data: contractData,
          })
          .strict(),
      )
      .max(32),
    validation: aiCanvasContextSchema.shape.validation,
    selectedIssue: betaInfrastructureSelectedIssueV1Schema.optional(),
    omissions: z
      .object({
        configurationValues: z.number().int().nonnegative(),
        externalRuntimeBindings: z.number().int().nonnegative(),
        unreferencedContracts: z.number().int().nonnegative(),
        executedTestEvidence: z.literal("not-included"),
        unsupportedOperations:
          aiCanvasContextSchema.shape.omissions.unwrap().shape
            .unsupportedOperations,
      })
      .strict(),
  })
  .strict();

const policyTypes = new Set([
  "aws.iam.policy-document",
  "aws.iam.policy-statement",
  "aws.iam.policy-condition",
  "aws.iam.managed-policy-attachment",
]);
// Identifiers only: no dereferencing and no credential-bearing output attributes.
const attributes = new Set([
  "arn",
  "name",
  "id",
  "url",
  "endpoint",
  "object-arn",
  "stream-arn",
]);
function reviewedReference(
  nodeId: string,
  attribute: string,
  nodes: z.infer<typeof architectureDocumentV3Schema>["nodes"],
) {
  const target = nodes.find((node) => node.id === nodeId);
  const service = target?.semantic.serviceType;
  const suffix = attribute.slice(attribute.lastIndexOf(".") + 1);
  if (
    !attributes.has(suffix) ||
    (service && attribute !== `${service}.${suffix}`)
  )
    throw new Error(
      "AI context contains an unreviewed resource attribute reference.",
    );
  return {
    nodeId,
    attribute,
    resolution: target ? ("included" as const) : ("unresolved" as const),
  };
}

function projectSettings(
  stored: z.infer<
    typeof architectureDocumentV3Schema
  >["nodes"][number]["semantic"]["configuration"],
  catalog: ProviderServiceConfigurationV1,
  nodes: z.infer<typeof architectureDocumentV3Schema>["nodes"],
) {
  if (
    stored.schemaId !== catalog.schemaId ||
    stored.schemaVersion !== catalog.schemaVersion
  )
    throw new Error(
      "AI context requires the exact reviewed configuration schema.",
    );
  const values: Record<string, z.infer<typeof reviewedLiteral>> = {};
  const references: z.infer<typeof reference>[] = [];
  const omittedConfigurationKeys: string[] = [];
  const conditionKey = stored.values["key" as never];
  if (
    catalog.schemaId === "aws.iam.policy-condition.configuration" &&
    conditionKey?.kind === "string" &&
    /password|secret|credential|private.?key|access.?key|token/iu.test(
      conditionKey.value,
    )
  )
    throw new Error(
      "AI context cannot expose an unreviewed sensitive condition value.",
    );
  for (const [key, value] of Object.entries(stored.values)) {
    const hint = catalog.uiHints.find((entry) => entry.property === key);
    const property = Object.entries(catalog.jsonSchema.properties).find(
      ([name]) => name === key,
    )?.[1];
    if (
      value.kind === "node-reference" &&
      hint?.valueSource === "node-reference" &&
      hint.securityImpact !== "secret-reference" &&
      property
    ) {
      references.push({
        property: key,
        ...reviewedReference(value.nodeId, value.attribute, nodes),
      });
      continue;
    }
    if (
      hint?.valueSource === "secret-reference" ||
      hint?.valueSource === "sensitive-variable-reference" ||
      value.kind === "secret-reference" ||
      value.kind === "variable-reference"
    ) {
      omittedConfigurationKeys.push(key);
      continue;
    }
    const allowed =
      isReviewedLiteralConfigurationPropertyV1(catalog, key) ||
      (hint?.valueSource === "literal" &&
        hint.securityImpact !== "secret-reference" &&
        property?.type === "array" &&
        property.items.type !== "string" &&
        !/password|secret|credential|private.?key|access.?key|token/iu.test(
          key,
        ));
    if (!allowed || !("value" in value) || !property) {
      omittedConfigurationKeys.push(key);
      continue;
    }
    const kind =
      property.type === "array"
        ? `${property.items.type === "string" ? "string" : "number"}-list`
        : property.type;
    if (value.kind !== kind || !reviewedLiteral.safeParse(value.value).success)
      throw new Error(
        "AI context contains malformed or oversized reviewed configuration.",
      );
    // Preserve invalid bounded literals as evidence for repairs; acceptance is
    // still owned by catalog validation and graph commands, never this reader.
    if (
      inspectModelValueForSecretCandidatesV1({ [key]: value.value })
        .detectedValueCount > 0
    )
      throw new Error("AI context contains sensitive configuration.");
    values[key] = value.value;
  }
  return {
    schemaId: stored.schemaId,
    schemaVersion: stored.schemaVersion,
    configuration: values,
    references,
    omittedConfigurationKeys,
  };
}

/** Traverse only strict typed records. Verify each immutable reference before
 * adding it; an incomplete closure never becomes a successful source context. */
function contractReferences(
  value: unknown,
): z.infer<typeof workloadContractReferenceV1Schema>[] {
  if (!value || typeof value !== "object") return [];
  const candidate = applicationContractReferenceV1Schema.safeParse(value);
  const legacy = workloadContractReferenceV1Schema.safeParse(value);
  if (candidate.success) return [candidate.data];
  if (legacy.success) return [legacy.data];
  return Object.values(value).flatMap(contractReferences);
}

export function projectAiSemanticContextV3(
  raw: unknown,
  selectedIssue?: z.infer<typeof betaInfrastructureSelectedIssueV1Schema>,
) {
  const document = architectureDocumentV3Schema.parse(raw);
  const { catalog } = resolveAwsModelCatalogV1(document.catalog);
  if (document.provider.id !== catalog.artifact.provider.id)
    throw new Error(
      "AI context provider does not match its immutable catalog.",
    );
  if (
    document.nodes.length > 100 ||
    document.edges.length > 1000 ||
    document.workloadBehavior.workloads.length > 8
  )
    throw new Error(
      "Scope the AI context within its resource, connection and workload limits.",
    );
  const resources = document.nodes.map((node, index) => {
    const service = catalog.requireService(node.semantic.serviceType);
    return {
      nodeId: node.id,
      deploymentKey: node.semantic.deploymentKey,
      sourcePath: `$.nodes[${String(index)}]`,
      serviceType: service.id,
      definitionVersion: service.definitionVersion,
      resourceType: node.semantic.resourceType,
      label: node.presentation.label,
      parentNodeId: node.semantic.parent?.nodeId ?? null,
      parent: node.semantic.parent ?? null,
      ownership: node.semantic.lifecycle.ownership,
      editable:
        node.semantic.lifecycle.ownership !== "generated" &&
        !policyTypes.has(service.id),
      ...projectSettings(
        node.semantic.configuration,
        service.configuration,
        document.nodes,
      ),
    };
  });
  const connections = document.edges.map((edge, index) => {
    const source = document.nodes.find(
      (node) => node.id === edge.semantic.source.nodeId,
    );
    const target = document.nodes.find(
      (node) => node.id === edge.semantic.target.nodeId,
    );
    const rules = catalog
      .listConnectionRules()
      .filter(
        (rule) =>
          rule.relationshipType === edge.semantic.relationshipType &&
          rule.source.serviceId === source?.semantic.serviceType &&
          rule.target.serviceId === target?.semantic.serviceType &&
          rule.source.portId === edge.semantic.source.port &&
          rule.target.portId === edge.semantic.target.port &&
          rule.configuration.schemaId ===
            edge.semantic.configuration.schemaId &&
          rule.configuration.schemaVersion ===
            edge.semantic.configuration.schemaVersion,
      );
    const rule = rules[0];
    if (!rule || rules.length !== 1)
      throw new Error(
        "AI context contains an unresolved or unreviewed connection.",
      );
    return {
      edgeId: edge.id,
      sourcePath: `$.edges[${String(index)}]`,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      sourceNodeId: edge.semantic.source.nodeId,
      sourcePort: edge.semantic.source.port,
      targetNodeId: edge.semantic.target.nodeId,
      targetPort: edge.semantic.target.port,
      relationshipType: edge.semantic.relationshipType,
      category: rule.category,
      ownership: edge.semantic.lifecycle.ownership,
      ...projectSettings(
        edge.semantic.configuration,
        rule.configuration,
        document.nodes,
      ),
    };
  });
  const workloads = document.workloadBehavior.workloads.map((item) => {
    if (!resources.some((node) => node.nodeId === item.owningNodeId))
      throw new Error("AI context has an unresolved workload owner.");
    const bindings = item.environment;
    const semantics = workloadV2Schema
      .omit({ environment: true, provenance: true })
      .strip()
      .parse(item);
    return workload.parse({
      ...semantics,
      environment: bindings.map((binding) => ({
        id: binding.id,
        name: binding.name,
        source:
          binding.value.kind === "node-attribute-reference"
            ? {
                kind: binding.value.kind,
                ...reviewedReference(
                  binding.value.nodeId,
                  binding.value.attribute,
                  document.nodes,
                ),
              }
            : { kind: "external-runtime-binding" },
      })),
    });
  });
  const pending = workloads.flatMap(contractReferences);
  const included = new Map<
    string,
    z.infer<typeof aiSemanticContextV3Schema>["applicationContracts"][number]
  >();
  while (pending.length) {
    const ref = pending.shift();
    if (!ref) break;
    const identity = `${ref.contractId}@${ref.contractVersion}`;
    const candidates = document.applicationContracts.contracts.filter(
      (record) =>
        record.contractId === ref.contractId &&
        record.contractVersion === ref.contractVersion,
    );
    const record = candidates[0];
    if (
      !record ||
      candidates.length !== 1 ||
      getApplicationContractRecordContentHash(record) !== ref.digest ||
      ("contractKind" in ref && ref.contractKind !== record.contractKind)
    )
      throw new Error(
        "AI context requires a complete, exact application contract closure.",
      );
    if (included.has(identity)) continue;
    if (included.size >= 32)
      throw new Error("Scope AI context to at most 32 application contracts.");
    const data = contractData.parse(
      Object.fromEntries(
        Object.entries(applicationContractRecordV1Schema.parse(record)).filter(
          ([key]) => key !== "provenance",
        ),
      ),
    );
    if (
      data.contractKind === "auth" &&
      data.roles.some((role) =>
        role.claimRequirements.some(
          (requirement) =>
            requirement.expectedValue !== undefined &&
            (data.claims.some(
              (claim) =>
                claim.name === requirement.claimName && claim.sensitive,
            ) ||
              /password|secret|credential|private.?key|access.?key|token/iu.test(
                requirement.claimName,
              )),
        ),
      )
    )
      throw new Error(
        "AI context cannot expose a sensitive authorization comparison value.",
      );
    included.set(identity, {
      digest: ref.digest,
      projectionDigest: digestCanonicalValue(data),
      data,
    });
    pending.push(...contractReferences(data));
  }
  const report = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    awsValidationRulesV1,
  );
  if (report.evaluationStatus !== "complete")
    throw new Error("AI context validation is incomplete.");
  const findings = [...report.findings];
  const ground = (
    location: (typeof report.findings)[number]["affected"][number],
  ) => {
    const owner = location.kind === "configuration" ? location.owner : location;
    const nodeId = "nodeId" in owner ? owner.nodeId : undefined;
    const edgeId = "edgeId" in owner ? owner.edgeId : undefined;
    const nodeIndex = document.nodes.findIndex((node) => node.id === nodeId);
    const edgeIndex = document.edges.findIndex((edge) => edge.id === edgeId);
    const path =
      edgeId && edgeIndex >= 0
        ? location.path.replace(
            /^\$\.edges\[\d+\]/u,
            `$.edges[${String(edgeIndex)}]`,
          )
        : nodeId && nodeIndex >= 0
          ? location.path.replace(
              /^\$\.nodes\[\d+\]/u,
              `$.nodes[${String(nodeIndex)}]`,
            )
          : location.path;
    return {
      path,
      validationPath: location.path,
      ...(nodeId ? { nodeId } : {}),
      ...(edgeId ? { edgeId } : {}),
      included: edgeId ? edgeIndex >= 0 : nodeId ? nodeIndex >= 0 : false,
    };
  };
  if (selectedIssue) {
    const identity = JSON.stringify(
      selectedIssue.affected
        .map((item) => [item.nodeId ?? item.edgeId, item.fieldPath])
        .sort(),
    );
    const index = findings.findIndex(
      (finding) =>
        finding.code === selectedIssue.code &&
        JSON.stringify(
          finding.affected
            .map((item) => {
              const owner = item.kind === "configuration" ? item.owner : item;
              return [
                "nodeId" in owner
                  ? owner.nodeId
                  : "edgeId" in owner
                    ? owner.edgeId
                    : undefined,
                item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
              ];
            })
            .sort(),
        ) === identity,
    );
    if (index < 0)
      throw new Error("The selected issue is missing from semantic context.");
    const selected = findings.splice(index, 1)[0];
    if (selected) findings.unshift(selected);
  }
  const context = aiSemanticContextV3Schema.parse({
    contextVersion: 3,
    producerVersion: "reviewed-semantic-v1",
    semanticDigest: getArchitectureDocumentHashes(document).contentHash,
    catalog: document.catalog,
    region: document.provider.region,
    resources,
    connections,
    workloads,
    applicationContracts: [...included.values()],
    validation: {
      status: report.evaluationStatus,
      totalFindings: report.findings.length,
      findings: findings.slice(0, 40).map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        title: finding.title,
        affectedPaths: finding.affected
          .slice(0, 20)
          .map((location) => ground(location).path),
        affectedEntities: finding.affected.slice(0, 20).map(ground),
      })),
    },
    ...(selectedIssue ? { selectedIssue } : {}),
    omissions: {
      configurationValues: [...resources, ...connections].reduce(
        (total, item) => total + item.omittedConfigurationKeys.length,
        0,
      ),
      externalRuntimeBindings: workloads.reduce(
        (total, item) =>
          total +
          item.environment.filter(
            (binding) => binding.source.kind === "external-runtime-binding",
          ).length,
        0,
      ),
      unreferencedContracts:
        document.applicationContracts.contracts.length - included.size,
      executedTestEvidence: "not-included",
      unsupportedOperations: [
        "edit-permission-policy",
        "update-existing-connection",
        "delete-resource-or-connection",
        "edit-reference-setting",
        "generate-verified-application-behavior",
      ],
    },
  });
  if (
    JSON.stringify(context).length > 128_000 ||
    inspectModelValueForSecretCandidatesV1(context).detectedValueCount > 0
  )
    throw new Error(
      "AI semantic context must be bounded and free of credentials.",
    );
  return context;
}
