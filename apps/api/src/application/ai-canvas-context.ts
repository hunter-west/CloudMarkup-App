import { z } from "zod";
import {
  architectureDocumentV3Schema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { executeArchitectureValidationRules } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { isReviewedLiteralConfigurationPropertyV1 } from "@cloudmarkup/provider-sdk";
import { inspectModelValueForSecretCandidatesV1 } from "@cloudmarkup/model-gateway";

const text = z.string().max(512);
const literal = z.union([
  z.string().max(256),
  z.number(),
  z.boolean(),
  z.array(z.string().max(256)).max(16),
]);
export const aiCanvasContextSchema = z
  .object({
    contextVersion: z.literal(2),
    projectionVersion: z.literal("reviewed-grounding-v1").optional(),
    region: z.string().max(64),
    resources: z
      .array(
        z
          .object({
            nodeId: text,
            sourcePath: text.optional(),
            serviceType: text,
            label: text,
            parentNodeId: text.nullable(),
            editable: z.boolean(),
            configuration: z.record(z.string().max(80), literal),
            omittedConfigurationKeys: z.array(z.string().max(80)).max(100),
          })
          .strict(),
      )
      .max(100),
    connections: z
      .array(
        z
          .object({
            edgeId: text.optional(),
            sourcePath: text.optional(),
            sourceNodeId: text,
            sourcePort: text.optional(),
            targetNodeId: text,
            targetPort: text.optional(),
            relationshipType: text,
            configuration: z.record(z.string().max(80), literal),
            omittedConfigurationKeys: z.array(z.string().max(80)).max(100),
          })
          .strict(),
      )
      .max(1000),
    workloads: z
      .array(
        z
          .object({
            nodeId: text,
            purposes: z
              .array(
                z
                  .object({ name: text, description: z.string().max(1500) })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .max(100),
    validation: z
      .object({
        status: z.enum(["complete", "incomplete"]),
        totalFindings: z.number().int().nonnegative(),
        findings: z
          .array(
            z
              .object({
                code: text,
                severity: text,
                title: text,
                affectedPaths: z.array(z.string().max(512)).max(20),
                affectedEntities: z
                  .array(
                    z
                      .object({
                        path: text,
                        validationPath: text.optional(),
                        nodeId: text.optional(),
                        edgeId: text.optional(),
                        included: z.boolean(),
                      })
                      .strict(),
                  )
                  .max(20)
                  .optional(),
              })
              .strict(),
          )
          .max(40),
      })
      .strict(),
    omissions: z
      .object({
        resources: z.number().int().nonnegative(),
        connections: z.number().int().nonnegative(),
        excludedServiceTypes: z.array(text).max(100),
        unsupportedOperations: z
          .array(
            z.enum([
              "edit-permission-policy",
              "update-existing-connection",
              "delete-resource-or-connection",
              "edit-reference-setting",
              "generate-verified-application-behavior",
            ]),
          )
          .max(5),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A versioned, bounded projection, never a raw graph or application source.
 * Catalog literal fields are further bounded and secret checked. */
export function projectAiCanvasContext(raw: unknown) {
  const document = architectureDocumentV3Schema.parse(raw);
  if (
    document.provider.id !== awsCatalogV1.artifact.provider.id ||
    document.catalog.id !== awsCatalogV1.artifact.catalog.id ||
    document.catalog.version !== awsCatalogV1.artifact.catalog.version ||
    document.catalog.digest !== awsCatalogV1.artifact.digest
  )
    throw new Error(
      "Upgrade the diagram catalog before sharing configuration with AI.",
    );
  const services = new Map(
    awsCatalogV1.listServices().map((s) => [String(s.id), s]),
  );
  const resources = document.nodes
    .filter(
      (node) =>
        services.has(node.semantic.serviceType) &&
        ![
          "aws.iam.policy-document",
          "aws.iam.policy-statement",
          "aws.iam.policy-condition",
        ].includes(node.semantic.serviceType),
    )
    .map((node) => {
      const service = services.get(node.semantic.serviceType);
      const schemaMatches =
        node.semantic.configuration.schemaId ===
          service?.configuration.schemaId &&
        node.semantic.configuration.schemaVersion ===
          service.configuration.schemaVersion;
      const projected = projectConfiguration(
        node.semantic.configuration,
        service?.configuration,
      );
      return {
        nodeId: node.id,
        sourcePath: `$.nodes[${String(document.nodes.indexOf(node))}]`,
        serviceType: node.semantic.serviceType,
        label: node.presentation.label,
        parentNodeId: node.semantic.parent?.nodeId ?? null,
        editable:
          schemaMatches &&
          node.semantic.lifecycle.ownership !== "generated" &&
          node.semantic.serviceType !== "aws.iam.managed-policy-attachment",
        ...projected,
      };
    });
  const ids = new Set(resources.map((r) => r.nodeId));
  const report = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    awsValidationRulesV1,
  );
  const groundedAffected = (
    affected: (typeof report.findings)[number]["affected"][number],
  ) => {
    const owner = affected.kind === "configuration" ? affected.owner : affected;
    const nodeId = "nodeId" in owner ? owner.nodeId : undefined;
    const edgeId = "edgeId" in owner ? owner.edgeId : undefined;
    const edgeIndex = document.edges.findIndex((edge) => edge.id === edgeId);
    const nodeIndex = document.nodes.findIndex((node) => node.id === nodeId);
    // Validation canonicalizes graph ordering. Bind its authoritative entity
    // IDs back to this exact input snapshot rather than reusing canonical indices.
    const path =
      edgeId && edgeIndex >= 0
        ? affected.path.replace(
            /^\$\.edges\[\d+\]/u,
            `$.edges[${String(edgeIndex)}]`,
          )
        : nodeId && nodeIndex >= 0
          ? affected.path.replace(
              /^\$\.nodes\[\d+\]/u,
              `$.nodes[${String(nodeIndex)}]`,
            )
          : affected.path;
    const edge = document.edges[edgeIndex];
    return {
      path,
      validationPath: affected.path,
      ...(nodeId ? { nodeId } : {}),
      ...(edgeId ? { edgeId } : {}),
      included: edgeId
        ? !!edge &&
          ids.has(edge.semantic.source.nodeId) &&
          ids.has(edge.semantic.target.nodeId)
        : nodeId
          ? ids.has(nodeId)
          : false,
    };
  };
  const context = aiCanvasContextSchema.parse({
    contextVersion: 2,
    projectionVersion: "reviewed-grounding-v1",
    region: document.provider.region,
    resources,
    connections: document.edges
      .filter(
        (edge) =>
          ids.has(edge.semantic.source.nodeId) &&
          ids.has(edge.semantic.target.nodeId),
      )
      .map((edge) => {
        const rule = awsCatalogV1
          .listConnectionRules()
          .find(
            (candidate) =>
              candidate.relationshipType === edge.semantic.relationshipType &&
              candidate.source.portId === edge.semantic.source.port &&
              candidate.target.portId === edge.semantic.target.port &&
              candidate.configuration.schemaId ===
                edge.semantic.configuration.schemaId &&
              candidate.source.serviceId ===
                document.nodes.find((n) => n.id === edge.semantic.source.nodeId)
                  ?.semantic.serviceType &&
              candidate.target.serviceId ===
                document.nodes.find((n) => n.id === edge.semantic.target.nodeId)
                  ?.semantic.serviceType,
          );
        return {
          edgeId: edge.id,
          sourcePath: `$.edges[${String(document.edges.indexOf(edge))}]`,
          sourceNodeId: edge.semantic.source.nodeId,
          sourcePort: edge.semantic.source.port,
          targetNodeId: edge.semantic.target.nodeId,
          targetPort: edge.semantic.target.port,
          relationshipType: edge.semantic.relationshipType,
          ...projectConfiguration(
            edge.semantic.configuration,
            rule?.configuration,
          ),
        };
      }),
    workloads: document.workloadBehavior.workloads
      .filter((w) => ids.has(w.owningNodeId))
      .map((w) => ({
        nodeId: w.owningNodeId,
        purposes: document.applicationContracts.contracts
          .filter(
            (c) =>
              c.contractKind === "behavior-operation" &&
              w.behaviorContracts.some(
                (r) =>
                  r.contractId === c.contractId &&
                  r.contractVersion === c.contractVersion,
              ),
          )
          .map((c) => ({
            name: c.displayName,
            description: c.description ?? "",
          })),
      })),
    validation: {
      status: report.evaluationStatus,
      totalFindings: report.findings.length,
      findings: report.findings.slice(0, 40).map((f) => ({
        code: f.code,
        severity: f.severity,
        title: f.title,
        affectedPaths: f.affected
          .slice(0, 20)
          .map((a) => groundedAffected(a).path),
        affectedEntities: f.affected.slice(0, 20).map(groundedAffected),
      })),
    },
    omissions: {
      resources: document.nodes.length - resources.length,
      connections: document.edges.filter(
        (edge) =>
          !ids.has(edge.semantic.source.nodeId) ||
          !ids.has(edge.semantic.target.nodeId),
      ).length,
      excludedServiceTypes: [
        ...new Set(
          document.nodes
            .filter((node) => !ids.has(node.id))
            .map((node) => node.semantic.serviceType),
        ),
      ].sort(),
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
    throw new Error("AI context must be bounded and free of credentials.");
  return context;
}
function literalValue(value: ConfigurationValue) {
  if (
    !["string", "number", "integer", "boolean", "string-list"].includes(
      value.kind,
    ) ||
    !("value" in value)
  )
    return undefined;
  const parsed = literal.safeParse(value.value);
  return parsed.success ? parsed.data : undefined;
}

type StoredConfiguration = z.infer<
  typeof architectureDocumentV3Schema
>["nodes"][number]["semantic"]["configuration"];
type CatalogConfiguration = ReturnType<
  typeof awsCatalogV1.requireService
>["configuration"];
function projectConfiguration(
  stored: StoredConfiguration,
  catalog: CatalogConfiguration | undefined,
) {
  const schemaMatches =
    stored.schemaId === catalog?.schemaId &&
    stored.schemaVersion === catalog.schemaVersion;
  const allowed = new Set(
    schemaMatches
      ? catalog.uiHints
          .filter((hint) =>
            isReviewedLiteralConfigurationPropertyV1(catalog, hint.property),
          )
          .map((hint) => String(hint.property))
      : [],
  );
  const configuration: Record<string, z.infer<typeof literal>> = {};
  const omittedConfigurationKeys: string[] = [];
  for (const [key, value] of Object.entries(stored.values)) {
    const candidate = literalValue(value);
    const type = Object.entries(catalog?.jsonSchema.properties ?? {}).find(
      ([property]) => property === key,
    )?.[1].type;
    // A malformed string under a numeric/boolean policy field must not bypass
    // the conservative text-key filter. Out-of-range numbers remain useful
    // evidence for deterministic configuration findings.
    const metadataTypeMatches =
      type === "integer"
        ? value.kind === "integer"
        : type === "number"
          ? value.kind === "number"
          : type === "boolean"
            ? value.kind === "boolean"
            : true;
    if (
      !allowed.has(key) ||
      !metadataTypeMatches ||
      candidate === undefined ||
      inspectModelValueForSecretCandidatesV1({ [key]: candidate })
        .detectedValueCount > 0
    )
      omittedConfigurationKeys.push(key);
    else configuration[key] = candidate;
  }
  return { configuration, omittedConfigurationKeys };
}
