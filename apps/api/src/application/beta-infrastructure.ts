import { z } from "zod";
import {
  aiSemanticContextV3Schema,
  projectAiSemanticContextV3,
} from "./ai-semantic-context.js";
import {
  admitBetaProposalV6,
  assertSelectedIssueSupportedV6,
  type BetaProposalCommandPreparerV1,
} from "./beta-proposal-applicability.js";
import {
  projectBetaInfrastructureConfiguration,
  validBetaInfrastructureSettings,
} from "./beta-infrastructure-settings.js";
import {
  aiCanvasContextSchema,
  projectAiCanvasContext,
} from "./ai-canvas-context.js";
import {
  sha256DigestSchema,
  configurationKeySchema,
  asyncJobDraftSubjectV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  betaInfrastructureSelectedIssueV1Schema,
} from "@cloudmarkup/schemas";
import {
  betaInfrastructureProposalSchema,
  createBetaInfrastructureProposalV1Schema,
  digestCanonicalValue,
  type CreateBetaInfrastructureProposalV1,
} from "@cloudmarkup/schemas";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import {
  createBetaInfrastructureModel,
  betaInfrastructureModelRequest,
  inspectModelValueForSecretCandidatesV1,
  type BetaConverseUsage,
} from "@cloudmarkup/model-gateway";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";
import { ApplicationError } from "./errors.js";

export type BetaProposalBaselineReaderV1 = (input: {
  ownership: z.input<typeof asyncJobTrustedOwnershipV1Schema>;
  subject: z.input<typeof asyncJobDraftSubjectV1Schema>;
}) => Promise<unknown>;

export function createBetaInfrastructureApplication(input: {
  readonly application?: Pick<
    CloudMarkupApplication,
    "getProject" | "getDraft" | "getCurrentPrincipal"
  >;
  readonly model: ReturnType<typeof createBetaInfrastructureModel>;
  readonly applicability?: {
    readonly preparer: BetaProposalCommandPreparerV1;
    /** Must enforce the supplied tenant/project and exact draft subject at read. */
    readonly readBaseline?: BetaProposalBaselineReaderV1;
    readonly forPrincipal?: (
      principal: PrincipalContext,
      ownership: { organizationId: string; projectId: string },
    ) => BetaProposalBaselineReaderV1;
  };
  readonly creditMeter?: {
    execute<T>(input: {
      readonly principal: PrincipalContext;
      readonly organizationId: string;
      readonly projectId: string;
      readonly request: PreparedBetaInfrastructureInput;
      readonly run: (
        onUsage: (usage: BetaConverseUsage) => Promise<void>,
      ) => Promise<T>;
    }): Promise<T>;
  };
}) {
  const serviceIds = new Set([
    "aws.lambda.function",
    "aws.iam.role",
    "aws.cloudwatch.log-group",
    "aws.apigateway.http-api",
    "aws.cognito.user-pool",
    "aws.cognito.user-pool-client",
    "aws.dynamodb.table",
    "aws.s3.bucket",
    "aws.sqs.queue",
    "aws.sns.topic",
  ]);
  const currentServiceIds = new Set(
    awsCatalogV1
      .listServices()
      .filter(
        (service) =>
          service.nodeKind.kind === "boundary" ||
          service.nodeKind.deployable ||
          [
            "aws.iam.managed-policy-attachment",
            "aws.ec2.route",
            "aws.ec2.route-table-association",
            "aws.ec2.security-group-ingress-rule",
            "aws.ec2.security-group-egress-rule",
            "aws.lambda.vpc-access-configuration",
            "aws.sns.subscription",
            "aws.eventbridge.rule",
            "aws.eventbridge.target",
          ].includes(service.id),
      )
      .map((service) => service.id),
  );
  const projectCatalog = (
    ids: ReadonlySet<string>,
    configure: boolean,
    lists = false,
    reviewedMetadata = false,
  ) => ({
    services: awsCatalogV1
      .listServices()
      .filter((service) => ids.has(service.id))
      .map((service) => ({
        id: service.id,
        description: service.description,
        placement: service.placement,
        ...(configure
          ? {
              configuration:
                service.id === "aws.iam.managed-policy-attachment"
                  ? {
                      ...service.configuration.jsonSchema,
                      properties: {
                        ...service.configuration.jsonSchema.properties,
                        attachmentKind: {
                          type: "string",
                          enum: ["managed-policy-attachment"],
                        },
                        managedPolicyReference: {
                          type: "string",
                          enum: [
                            "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
                          ],
                        },
                      },
                    }
                  : service.configuration.jsonSchema,
            }
          : {}),
        ...(lists
          ? projectBetaInfrastructureConfiguration(
              service.id === "aws.iam.managed-policy-attachment"
                ? {
                    ...service.configuration,
                    jsonSchema: {
                      ...service.configuration.jsonSchema,
                      properties: {
                        ...service.configuration.jsonSchema.properties,
                        [configurationKeySchema.parse("attachmentKind")]: {
                          type: "string",
                          enum: ["managed-policy-attachment"],
                        },
                        [configurationKeySchema.parse(
                          "managedPolicyReference",
                        )]: {
                          type: "string",
                          enum: [
                            "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
                          ],
                        },
                      },
                    },
                  }
                : service.configuration,
              reviewedMetadata,
            )
          : {}),
      })),
    connections: awsCatalogV1
      .listConnectionRules()
      .filter(
        (rule) =>
          rule.implementation.status === "implemented" &&
          ids.has(rule.source.serviceId) &&
          ids.has(rule.target.serviceId),
      )
      .map((rule) => ({
        id: rule.id,
        source: rule.source,
        target: rule.target,
        description: configure ? rule.education.summary : rule.education,
        configuration: rule.configuration.jsonSchema,
        ...(lists
          ? projectBetaInfrastructureConfiguration(
              rule.configuration,
              reviewedMetadata,
            )
          : {}),
      })),
  });
  const prepare = async (
    principal: PrincipalContext,
    projectId: string,
    raw: CreateBetaInfrastructureProposalV1,
    etag: string,
  ) => {
    const application = input.application;
    if (!application)
      throw new ApplicationError(
        "service_unavailable",
        "Proposal preparation requires an authenticated application.",
      );
    const request = createBetaInfrastructureProposalV1Schema.parse(raw);
    const allowedServices =
      (request.proposalVersion ?? 1) >= 3 ? currentServiceIds : serviceIds;
    const authorize = async () => {
      if (Date.parse(principal.expiresAt) <= Date.now())
        throw new ApplicationError(
          "authentication_required",
          "Sign in again to request a proposal.",
        );
      const project = await application.getProject(principal, projectId);
      if (project.value.lifecycleStatus !== "active")
        throw new ApplicationError(
          "access_denied",
          "This project is not active.",
        );
      const current = await application.getCurrentPrincipal(principal);
      if (
        !current.organizationContexts.some(
          (organization) =>
            organization.organizationId === project.value.organizationId &&
            organization.capabilities.includes("projects.mutate"),
        )
      )
        throw new ApplicationError(
          "access_denied",
          "Editing permission is required for AI proposals.",
        );
      const draft = await application.getDraft(principal, projectId);
      if (
        draft.etag !== etag ||
        draft.value.architectureDocument.architectureId !==
          request.architectureDocument.architectureId ||
        draft.value.architectureDocument.documentId !==
          request.architectureDocument.documentId
      )
        throw new ApplicationError(
          "precondition_failed",
          "The draft changed. Reload it before requesting a proposal.",
        );
      return { project, draft };
    };
    const { project, draft } = await authorize();
    if (request.proposalVersion === 6) {
      const reader =
        input.applicability?.forPrincipal?.(principal, {
          organizationId: project.value.organizationId,
          projectId,
        }) ?? input.applicability?.readBaseline;
      if (!input.applicability || !reader)
        throw new ApplicationError(
          "service_unavailable",
          "Semantic AI admission requires the reviewed applicability host.",
        );
      if (
        digestCanonicalValue(request.architectureDocument) !==
        digestCanonicalValue(draft.value.architectureDocument)
      )
        throw new ApplicationError(
          "precondition_failed",
          "Save the exact canvas before requesting a semantic AI proposal.",
        );
      if (
        request.architectureDocument.catalog.digest !==
        awsCatalogV1.artifact.digest
      )
        throw new ApplicationError(
          "precondition_failed",
          "Semantic proposal mutations require the current reviewed catalog. Upgrade through the catalog workflow first.",
        );
      const saved = await reader({
        ownership: { organizationId: project.value.organizationId, projectId },
        subject: {
          kind: "draft",
          draftId: draft.value.id,
          draftVersion: draft.value.version,
          etag,
          contentDigest: digestCanonicalValue(draft.value.architectureDocument),
        },
      });
      if (
        digestCanonicalValue(saved) !==
        digestCanonicalValue(request.architectureDocument)
      )
        throw new ApplicationError(
          "precondition_failed",
          "The exact saved proposal baseline changed.",
        );
      if (request.selectedIssue) {
        try {
          assertSelectedIssueSupportedV6(
            request.architectureDocument,
            request.selectedIssue,
          );
        } catch (error) {
          throw new ApplicationError(
            "invalid_request",
            error instanceof Error
              ? error.message
              : "Review the selected issue manually.",
          );
        }
      }
    }
    const resources = request.architectureDocument.nodes
      .filter(
        (node) =>
          allowedServices.has(node.semantic.serviceType) &&
          node.semantic.lifecycle.ownership !== "generated",
      )
      .map((node) => ({
        nodeId: node.id,
        serviceType: node.semantic.serviceType,
        label: node.presentation.label,
      }));
    if ((request.proposalVersion ?? 1) >= 2 && resources.length > 100)
      throw new ApplicationError(
        "invalid_request",
        "AI diagram updates currently support up to 100 editable resources.",
      );
    const resourceIds = new Set<string>(
      resources.map((resource) => resource.nodeId),
    );
    const existingArchitecture =
      request.proposalVersion === 6
        ? reviewedSemanticContext(
            request.architectureDocument,
            request.selectedIssue,
          )
        : request.proposalVersion === 4 || request.proposalVersion === 5
          ? reviewedCanvasContext(request.architectureDocument)
          : (request.proposalVersion ?? 1) >= 2
            ? {
                region: request.architectureDocument.provider.region,
                resources,
                connections: request.architectureDocument.edges
                  .filter(
                    (edge) =>
                      resourceIds.has(edge.semantic.source.nodeId) &&
                      resourceIds.has(edge.semantic.target.nodeId),
                  )
                  .map((edge) => ({
                    sourceNodeId: edge.semantic.source.nodeId,
                    targetNodeId: edge.semantic.target.nodeId,
                    relationshipType: edge.semantic.relationshipType,
                  })),
              }
            : undefined;
    if (
      inspectModelValueForSecretCandidatesV1({
        requirements: request.requirements,
        existingArchitecture,
      }).detectedValueCount > 0
    )
      throw new ApplicationError(
        "invalid_request",
        "Remove credentials and secrets from the requirements and resource labels.",
      );
    return {
      organizationId: project.value.organizationId,
      subject: asyncJobDraftSubjectV1Schema.parse({
        kind: "draft",
        draftId: draft.value.id,
        draftVersion: draft.value.version,
        etag,
        contentDigest: digestCanonicalValue(draft.value.architectureDocument),
      }),
      request: preparedBetaInfrastructureInputSchema.parse({
        contractVersion: 1,
        requirements: request.requirements,
        ...((request.proposalVersion ?? 1) >= 4
          ? {
              modelInputBytes: new TextEncoder().encode(
                JSON.stringify(
                  betaInfrastructureModelRequest({
                    requirements: request.requirements,
                    proposalVersion: request.proposalVersion ?? 1,
                    existingArchitecture,
                    catalog: projectCatalog(
                      allowedServices,
                      true,
                      (request.proposalVersion ?? 1) >= 5,
                      (request.proposalVersion ?? 1) >= 5,
                    ),
                  }),
                ),
              ).length,
            }
          : {}),
        proposalVersion: request.proposalVersion ?? 1,
        ...((request.proposalVersion ?? 1) >= 5
          ? {
              catalogDigest: awsCatalogV1.artifact.digest,
              configurationProjectionVersion: 2,
            }
          : {}),
        ...(request.proposalVersion === 6
          ? {
              validationOwnership: {
                organizationId: project.value.organizationId,
                projectId,
              },
              validationSubject: {
                kind: "draft",
                draftId: draft.value.id,
                draftVersion: draft.value.version,
                etag,
                contentDigest: digestCanonicalValue(
                  draft.value.architectureDocument,
                ),
              },
              ...(request.selectedIssue
                ? { selectedIssue: request.selectedIssue }
                : {}),
            }
          : {}),
        architectureDigest: digestCanonicalValue(request.architectureDocument),
        savedArchitectureDigest: digestCanonicalValue(
          draft.value.architectureDocument,
        ),
        ...(existingArchitecture === undefined ? {} : { existingArchitecture }),
      }),
    };
  };
  const generate = async (
    raw: PreparedBetaInfrastructureInput,
    signal: AbortSignal,
    authorize: () => Promise<void>,
    timeout = 180_000,
    onUsage?: (usage: BetaConverseUsage) => Promise<void>,
    baselineReader?: BetaProposalBaselineReaderV1,
  ) => {
    const request = preparedBetaInfrastructureInputSchema.parse(raw);
    await authorize();
    if (
      request.proposalVersion >= 5 &&
      request.catalogDigest !== awsCatalogV1.artifact.digest
    )
      throw new ApplicationError(
        "precondition_failed",
        "The catalog changed. Request a fresh AI proposal.",
      );
    const aborted = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    aborted.throwIfAborted();
    const readBaseline = async () => {
      if (
        !input.applicability ||
        !(baselineReader ?? input.applicability.readBaseline) ||
        !request.validationOwnership ||
        !request.validationSubject
      )
        throw new ApplicationError(
          "service_unavailable",
          "Semantic AI admission requires the reviewed applicability host.",
        );
      const reader = baselineReader ?? input.applicability.readBaseline;
      if (!reader) throw new Error("Applicability reader unavailable.");
      await authorize();
      const baseline = await reader({
        ownership: request.validationOwnership,
        subject: request.validationSubject,
      });
      if (digestCanonicalValue(baseline) !== request.architectureDigest)
        throw new ApplicationError(
          "precondition_failed",
          "The admitted saved baseline changed.",
        );
      await authorize();
      return baseline;
    };
    if (request.proposalVersion === 6) await readBaseline();
    const ids = request.proposalVersion >= 3 ? currentServiceIds : serviceIds;
    let proposal;
    try {
      proposal = betaInfrastructureProposalSchema.parse(
        await input.model({
          requirements: request.requirements,
          proposalVersion: request.proposalVersion,
          ...(request.existingArchitecture === undefined
            ? {}
            : { existingArchitecture: request.existingArchitecture }),
          catalog: projectCatalog(
            ids,
            request.proposalVersion >= 3,
            request.proposalVersion >= 5,
            request.configurationProjectionVersion === 2,
          ),
          signal: aborted,
          ...(onUsage ? { onUsage } : {}),
        }),
      );
    } catch {
      throw new ApplicationError(
        "service_unavailable",
        "The AI proposal could not finish. Please retry.",
      );
    }
    if (proposal.contractVersion !== request.proposalVersion)
      throw new ApplicationError(
        "service_unavailable",
        "The AI returned an incompatible proposal. Please retry.",
      );
    const resourceIds = new Set(
      request.existingArchitecture?.resources
        .filter((r) => !("editable" in r) || r.editable)
        .map((r) => r.nodeId),
    );
    if (
      proposal.contractVersion !== 1 &&
      proposal.existingResources.some((r) => !resourceIds.has(r.nodeId))
    )
      throw new ApplicationError(
        "service_unavailable",
        "The AI referenced an unavailable resource. Request a fresh proposal.",
      );
    if (
      inspectModelValueForSecretCandidatesV1(proposal).detectedValueCount > 0 ||
      proposal.resources.some(
        (resource) =>
          !ids.has(resource.serviceType) ||
          (resource.serviceType === "aws.iam.managed-policy-attachment" &&
            !z
              .object({
                attachmentKind: z.literal("managed-policy-attachment"),
                managedPolicyReference: z.literal(
                  "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
                ),
              })
              .loose()
              .safeParse(
                "configuration" in resource
                  ? resource.configuration
                  : undefined,
              ).success),
      )
    )
      throw new ApplicationError(
        "service_unavailable",
        "The AI returned unsupported or sensitive configuration. Request a fresh proposal.",
      );
    if (proposal.contractVersion >= 5 && "updates" in proposal) {
      const context = request.existingArchitecture;
      const existing = new Map(
        context?.resources.map((resource) => [resource.nodeId, resource]),
      );
      const services = new Map([
        ...proposal.resources.map(
          (resource) => [resource.key, resource.serviceType] as const,
        ),
        ...proposal.existingResources.map(
          (resource) =>
            [resource.key, existing.get(resource.nodeId)?.serviceType] as const,
        ),
      ]);
      const validServiceSettings = (
        serviceType: string | undefined,
        settings: Parameters<typeof validBetaInfrastructureSettings>[1],
      ) => {
        const service = awsCatalogV1
          .listServices()
          .find((candidate) => candidate.id === serviceType);
        return (
          service !== undefined &&
          validBetaInfrastructureSettings(
            service.configuration,
            settings,
            request.configurationProjectionVersion === 2,
          )
        );
      };
      if (
        !context ||
        !("contextVersion" in context) ||
        proposal.resources.some(
          (resource) =>
            !validServiceSettings(
              resource.serviceType,
              resource.configuration ?? {},
            ),
        ) ||
        proposal.updates.some((update) => {
          const serviceType = services.get(update.resourceKey);
          return (
            !serviceType ||
            [
              "aws.iam.policy-document",
              "aws.iam.policy-statement",
              "aws.iam.policy-condition",
              "aws.iam.managed-policy-attachment",
            ].includes(serviceType) ||
            !validServiceSettings(serviceType, update.configuration)
          );
        }) ||
        proposal.connections.some((connection) => {
          const rule = awsCatalogV1
            .listConnectionRules()
            .find((candidate) => candidate.id === connection.ruleId);
          return (
            rule?.implementation.status !== "implemented" ||
            rule.source.serviceId !== services.get(connection.sourceKey) ||
            rule.target.serviceId !== services.get(connection.targetKey) ||
            !validBetaInfrastructureSettings(
              rule.configuration,
              connection.configuration,
              request.configurationProjectionVersion === 2,
            )
          );
        })
      )
        throw new ApplicationError(
          "service_unavailable",
          "The AI returned unsupported configuration. Request a fresh proposal.",
        );
    }
    await authorize();
    let applicability;
    if (request.proposalVersion === 6) {
      const baseline = await readBaseline();
      if (!input.applicability)
        throw new Error("Applicability host unavailable.");
      try {
        // This must finish before returning to the worker's objects.put/meter.record
        // or a synchronous meter's successful delivery. Questions remain priced.
        applicability = admitBetaProposalV6({
          document: baseline,
          proposal,
          context: request.existingArchitecture,
          architectureDigest: request.architectureDigest,
          ...(request.selectedIssue
            ? { selectedIssue: request.selectedIssue }
            : {}),
          preparer: input.applicability.preparer,
        });
      } catch {
        throw new ApplicationError(
          "service_unavailable",
          "The AI proposal failed deterministic applicability review. No result can be delivered.",
        );
      }
      await authorize();
    }
    if (aborted.aborted)
      throw new ApplicationError(
        "service_unavailable",
        "The AI proposal was cancelled.",
      );
    return {
      contractVersion: 1 as const,
      architectureDigest: request.architectureDigest,
      proposal,
      ...(applicability ? { applicability } : {}),
    };
  };
  return {
    prepare,
    generate,
    async propose(
      principal: PrincipalContext,
      projectId: string,
      raw: CreateBetaInfrastructureProposalV1,
      etag: string,
      signal: AbortSignal,
    ) {
      const prepared = await prepare(principal, projectId, raw, etag);
      const run = (onUsage?: (usage: BetaConverseUsage) => Promise<void>) =>
        generate(
          prepared.request,
          signal,
          async () => {
            await prepare(principal, projectId, raw, etag);
          },
          20_000,
          onUsage,
          input.applicability?.forPrincipal?.(principal, {
            organizationId: prepared.organizationId,
            projectId,
          }) ?? input.applicability?.readBaseline,
        );
      return input.creditMeter
        ? input.creditMeter.execute({
            principal,
            organizationId: prepared.organizationId,
            projectId,
            request: prepared.request,
            run,
          })
        : run();
    },
  };
}
export type BetaInfrastructureApplication = ReturnType<
  typeof createBetaInfrastructureApplication
>;

// Only this reviewed projection is persisted for a background model request.
export const preparedBetaInfrastructureInputSchema = z
  .object({
    contractVersion: z.literal(1),
    requirements: z.string().min(5).max(8000),
    modelInputBytes: z.number().int().min(1).max(2_000_000).optional(),
    catalogDigest: sha256DigestSchema.optional(),
    configurationProjectionVersion: z.literal(2).optional(),
    validationOwnership: asyncJobTrustedOwnershipV1Schema.optional(),
    validationSubject: asyncJobDraftSubjectV1Schema.optional(),
    selectedIssue: betaInfrastructureSelectedIssueV1Schema.optional(),
    proposalVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    architectureDigest: sha256DigestSchema,
    savedArchitectureDigest: sha256DigestSchema,
    existingArchitecture: z
      .union([
        aiCanvasContextSchema,
        aiSemanticContextV3Schema,
        z
          .object({
            region: z.string().max(64),
            resources: z
              .array(
                z
                  .object({
                    nodeId: z.string().min(1).max(128),
                    serviceType: z.string().min(1).max(128),
                    label: z.string().max(512),
                  })
                  .strict(),
              )
              .max(100),
            connections: z
              .array(
                z
                  .object({
                    sourceNodeId: z.string().min(1).max(128),
                    targetNodeId: z.string().min(1).max(128),
                    relationshipType: z.string().min(1).max(128),
                  })
                  .strict(),
              )
              .max(1000),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.configurationProjectionVersion === 2 &&
      ((value.proposalVersion !== 5 && value.proposalVersion !== 6) ||
        !value.existingArchitecture ||
        !("contextVersion" in value.existingArchitecture) ||
        (value.proposalVersion === 5 &&
          (!("projectionVersion" in value.existingArchitecture) ||
            value.existingArchitecture.projectionVersion !==
              "reviewed-grounding-v1")) ||
        (value.proposalVersion === 6 &&
          value.existingArchitecture.contextVersion !== 3))
    )
      context.addIssue({
        code: "custom",
        message:
          "The configuration projection requires its matching reviewed context.",
      });
    if (
      value.proposalVersion >= 5 &&
      (!value.catalogDigest ||
        !value.existingArchitecture ||
        !("contextVersion" in value.existingArchitecture))
    )
      context.addIssue({
        code: "custom",
        message: "V5 requires reviewed context and an exact catalog binding.",
      });
    if (
      value.proposalVersion === 6 &&
      (value.configurationProjectionVersion !== 2 ||
        !value.modelInputBytes ||
        !value.validationOwnership?.projectId ||
        value.validationSubject?.contentDigest !== value.architectureDigest ||
        value.savedArchitectureDigest !== value.architectureDigest ||
        !value.existingArchitecture ||
        !("contextVersion" in value.existingArchitecture) ||
        value.existingArchitecture.contextVersion !== 3 ||
        value.existingArchitecture.catalog.digest !== value.catalogDigest ||
        JSON.stringify(value.existingArchitecture.selectedIssue) !==
          JSON.stringify(value.selectedIssue))
    )
      context.addIssue({
        code: "custom",
        message:
          "V6 requires an exact saved tenant-owned applicability baseline and semantic context.",
      });
    if (
      value.proposalVersion !== 6 &&
      (value.validationOwnership ||
        value.validationSubject ||
        value.selectedIssue ||
        (value.existingArchitecture &&
          "contextVersion" in value.existingArchitecture &&
          value.existingArchitecture.contextVersion === 3))
    )
      context.addIssue({
        code: "custom",
        message: "Semantic context and applicability authority require V6.",
      });
  });
export type PreparedBetaInfrastructureInput = z.infer<
  typeof preparedBetaInfrastructureInputSchema
>;

function reviewedCanvasContext(document: unknown) {
  try {
    return projectAiCanvasContext(document);
  } catch {
    throw new ApplicationError(
      "invalid_request",
      "AI context requires the current catalog, up to 100 resources, bounded settings and descriptions without credentials. Review your canvas before retrying.",
    );
  }
}
function reviewedSemanticContext(
  document: unknown,
  selectedIssue?: z.infer<typeof betaInfrastructureSelectedIssueV1Schema>,
) {
  try {
    return projectAiSemanticContextV3(document, selectedIssue);
  } catch {
    throw new ApplicationError(
      "invalid_request",
      "Complete the reviewed catalog schemas, references and contract closure within AI limits before retrying.",
    );
  }
}
