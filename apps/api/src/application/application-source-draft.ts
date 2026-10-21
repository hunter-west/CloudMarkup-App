import { projectAiCanvasContext } from "./ai-canvas-context.js";
import { projectAiSemanticContextV3 } from "./ai-semantic-context.js";
import { validateArchitectureDocumentSemantics } from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import {
  betaApplicationSourceSchema,
  BETA_APPLICATION_SOURCE_INSTRUCTIONS,
  BETA_APPLICATION_SOURCE_REVIEW_INSTRUCTIONS,
  BETA_APPLICATION_SOURCE_SEMANTIC_INSTRUCTIONS,
  BETA_APPLICATION_SOURCE_SEMANTIC_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_LEGACY_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_MODEL_ID,
  inspectModelValueForSecretCandidatesV1,
  type createBetaApplicationSourceModel,
  type BetaConverseUsage,
  type BetaApplicationSource,
} from "@cloudmarkup/model-gateway";
import {
  canonicalSemanticDigest,
  sha256Digest,
  solutionExportSupplementalFileV1Schema,
  type SolutionExportSupplementalFileV1,
} from "@cloudmarkup/solution-export";
import type { SolutionExportWorkflowDependencies } from "@cloudmarkup/solution-export-workflow";

export type ApplicationSourceDraftPort = NonNullable<
  SolutionExportWorkflowDependencies["applicationSourceDraft"]
>;
export function applicationSourceContext(
  raw: unknown,
  reviewed: boolean | 3 = false,
) {
  const document = architectureDocumentV3Schema.parse(raw);
  if (
    reviewed === 3 &&
    validateArchitectureDocumentSemantics(document).length > 0
  )
    throw new Error(
      "Semantic application source requires complete valid workload and contract references.",
    );
  const canvas =
    reviewed === 3
      ? projectAiSemanticContextV3(document)
      : reviewed
        ? projectAiCanvasContext(document)
        : null;
  const resources =
    canvas?.resources ??
    document.nodes
      .filter(
        (n) =>
          !["aws.iam.policy-document", "aws.iam.policy-statement"].includes(
            n.semantic.serviceType,
          ),
      )
      .map((n) => ({
        nodeId: n.id,
        serviceType: n.semantic.resourceType,
        label: n.presentation.label,
      }));
  if (resources.length > 100)
    throw new Error(
      "Application source supports up to 100 resources per revision.",
    );
  const resourceIds = new Set(resources.map((n) => n.nodeId));
  const connections =
    canvas?.connections ??
    document.edges
      .filter(
        (e) =>
          resourceIds.has(e.semantic.source.nodeId) &&
          resourceIds.has(e.semantic.target.nodeId),
      )
      .map((e) => ({
        sourceNodeId: e.semantic.source.nodeId,
        targetNodeId: e.semantic.target.nodeId,
        relationshipType: e.semantic.relationshipType,
      }));
  const workloads = document.workloadBehavior.workloads
    .filter((w) =>
      resources.some(
        (n) =>
          n.nodeId === w.owningNodeId &&
          n.serviceType === "aws.lambda.function",
      ),
    )
    .map((w) => ({
      workloadId: w.id,
      nodeId: w.owningNodeId,
      ...(canvas?.contextVersion === 3
        ? {
            semantics: canvas.workloads.find((item) => item.id === w.id),
          }
        : {}),
      relatedConnections: connections
        .filter(
          (edge) =>
            edge.sourceNodeId === w.owningNodeId ||
            edge.targetNodeId === w.owningNodeId,
        )
        .map((edge) => ({
          ...edge,
          direction:
            edge.targetNodeId === w.owningNodeId ? "incoming" : "outgoing",
        })),
      purpose: document.applicationContracts.contracts
        .filter(
          (c) =>
            c.contractKind === "behavior-operation" &&
            w.behaviorContracts.some(
              (ref) =>
                ref.contractId === c.contractId &&
                ref.contractVersion === c.contractVersion,
            ),
        )
        .map((c) => ({
          name: c.displayName,
          description: c.description ?? "",
        })),
      environmentBindings: connections
        .filter(
          (e) =>
            e.sourceNodeId === w.owningNodeId &&
            resources.find((n) => n.nodeId === e.targetNodeId)?.serviceType !==
              "aws.cloudwatch.log-group",
        )
        .map((e) => ({
          variable:
            "RESOURCE_" +
            sha256Digest(e.targetNodeId).slice(7, 23).toUpperCase(),
          nodeId: e.targetNodeId,
          relationshipType: e.relationshipType,
        })),
    }));
  if (workloads.length === 0 || workloads.length > 8)
    throw new Error(
      "Select a revision with one to eight Lambda workloads for AI source generation.",
    );
  if (
    canvas?.contextVersion === 3 &&
    workloads.some(
      (item) =>
        !item.semantics ||
        item.semantics.operations.length === 0 ||
        item.semantics.behaviorContracts.length === 0 ||
        item.semantics.unresolvedRequirementIds.length > 0 ||
        item.semantics.implementationRequirements.some(
          (requirement) => requirement.blocking,
        ),
    )
  )
    throw new Error(
      "Complete the workload operations and contracts before requesting semantic application source.",
    );
  if (
    canvas?.contextVersion === 3 &&
    ([...canvas.resources, ...canvas.connections].some((item) =>
      item.references.some((ref) => ref.resolution !== "included"),
    ) ||
      canvas.workloads.some(
        (item) =>
          item.environment.some(
            (binding) =>
              binding.source.kind === "node-attribute-reference" &&
              binding.source.resolution !== "included",
          ) ||
          item.triggers.some(
            (trigger) =>
              !canvas.connections.some(
                (edge) =>
                  edge.edgeId === trigger.edgeId &&
                  edge.targetNodeId === item.owningNodeId,
              ),
          ) ||
          item.downstreamActions.some(
            (action) =>
              !canvas.connections.some(
                (edge) =>
                  edge.edgeId === action.edgeId &&
                  edge.sourceNodeId === item.owningNodeId,
              ),
          ),
      ))
  )
    throw new Error(
      "Resolve all workload resource and trigger bindings before semantic application source generation.",
    );
  if (
    reviewed !== 3 &&
    workloads.some(
      (w) => !w.purpose.some((p) => p.description.trim().length > 0),
    )
  )
    throw new Error(
      "Describe each Lambda workload's purpose before requesting application source.",
    );
  if (
    canvas &&
    workloads.some(
      (workload) =>
        canvas.resources.find((resource) => resource.nodeId === workload.nodeId)
          ?.configuration["runtime"] !== "nodejs24.x",
    )
  )
    throw new Error(
      "AI application source currently requires Node.js 24 Lambda configuration. Review the runtime before generating.",
    );
  const context = {
    ...(canvas ?? {}),
    region: document.provider.region,
    resources: canvas?.resources ?? resources,
    connections: canvas?.connections ?? connections,
    workloads,
  };
  if (
    JSON.stringify(context).length > (reviewed ? 128_000 : 64_000) ||
    inspectModelValueForSecretCandidatesV1(context).detectedValueCount > 0
  )
    throw new Error(
      "Application descriptions must be bounded and free of credentials.",
    );
  return context;
}
function validateSourceResponse(
  response: BetaApplicationSource,
  context: ReturnType<typeof applicationSourceContext>,
) {
  if (
    response.contractVersion !==
      ("contextVersion" in context ? context.contextVersion : 1) ||
    response.workloads.length !== context.workloads.length ||
    new Set(response.workloads.map((w) => w.workloadId)).size !==
      response.workloads.length ||
    response.workloads.some(
      (w) => !context.workloads.some((c) => c.workloadId === w.workloadId),
    ) ||
    JSON.stringify(response).length > 262_144 ||
    inspectModelValueForSecretCandidatesV1(response).detectedValueCount > 0
  )
    throw new Error("Application source did not match the reviewed workloads.");
  return response;
}
export function createApplicationSourceDraftPort(options: {
  model: ReturnType<typeof createBetaApplicationSourceModel>;
  credits?: {
    generate(input: {
      readonly cacheKey: string;
      readonly context: ReturnType<typeof applicationSourceContext>;
      readonly invoke: (
        onUsage: (usage: BetaConverseUsage) => Promise<void>,
      ) => Promise<BetaApplicationSource>;
      readonly persist: (value: BetaApplicationSource) => Promise<{
        readonly objectId: string;
        readonly contentSha256: string;
      }>;
    }): Promise<BetaApplicationSource>;
    onCacheHit?(cacheKey: string): Promise<void>;
  };
  authorize: () => Promise<void>;
  cache: {
    read: (key: string) => Promise<unknown>;
    write: (key: string, value: unknown) => Promise<unknown>;
  };
}): ApplicationSourceDraftPort {
  return {
    async generate(input) {
      if (
        ![
          "ai-source-draft-v1",
          "ai-source-draft-v2",
          "ai-source-draft-v3",
        ].includes(input.request.applicationSource ?? "")
      )
        throw new Error("Application source was not requested.");
      const semantic = input.request.applicationSource === "ai-source-draft-v3";
      const reviewed =
        semantic || input.request.applicationSource === "ai-source-draft-v2";
      const promptVersion = semantic
        ? BETA_APPLICATION_SOURCE_SEMANTIC_PROMPT_VERSION
        : reviewed
          ? BETA_APPLICATION_SOURCE_PROMPT_VERSION
          : BETA_APPLICATION_SOURCE_LEGACY_PROMPT_VERSION;
      const context = applicationSourceContext(
        input.sources.architectureDocument,
        semantic ? 3 : reviewed,
      );
      const contextDigest = digestCanonicalValue(context);
      const producer = {
        id: "cloudmarkup.ai.application-source-draft",
        version: promptVersion,
        digest: digestCanonicalValue({
          model: BETA_APPLICATION_SOURCE_MODEL_ID,
          instructions: semantic
            ? BETA_APPLICATION_SOURCE_SEMANTIC_INSTRUCTIONS
            : reviewed
              ? BETA_APPLICATION_SOURCE_REVIEW_INSTRUCTIONS
              : BETA_APPLICATION_SOURCE_INSTRUCTIONS,
        }),
      };
      const cacheKey = digestCanonicalValue({
        subject: input.request.subject,
        contextDigest,
        producer,
      });
      await options.authorize();
      input.signal.throwIfAborted();
      const cached = await options.cache.read(cacheKey);
      const invoke = (onUsage?: (usage: BetaConverseUsage) => Promise<void>) =>
        options.model({
          context,
          reviewed,
          ...(semantic ? { semantic: true } : {}),
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(240_000)]),
          ...(onUsage ? { onUsage } : {}),
        });
      let response: BetaApplicationSource;
      if (cached !== undefined) {
        response = validateSourceResponse(
          betaApplicationSourceSchema.parse(cached),
          context,
        );
        await options.credits?.onCacheHit?.(cacheKey);
      } else if (options.credits) {
        response = await options.credits.generate({
          cacheKey,
          context,
          invoke: async (onUsage) =>
            validateSourceResponse(await invoke(onUsage), context),
          persist: async (value) => {
            await options.authorize();
            input.signal.throwIfAborted();
            const receipt = await options.cache.write(cacheKey, value);
            if (
              !receipt ||
              typeof receipt !== "object" ||
              !("objectId" in receipt) ||
              typeof receipt.objectId !== "string" ||
              !("contentSha256" in receipt) ||
              typeof receipt.contentSha256 !== "string"
            )
              throw new Error(
                "Application source publication receipt is unavailable.",
              );
            return {
              objectId: receipt.objectId,
              contentSha256: receipt.contentSha256,
            };
          },
        });
      } else {
        response = validateSourceResponse(await invoke(), context);
        await options.authorize();
        input.signal.throwIfAborted();
        await options.cache.write(cacheKey, response);
      }
      if (reviewed && response.contractVersion !== (semantic ? 3 : 2))
        throw new Error(
          "The AI source review is missing. Request a fresh export.",
        );
      await options.authorize();
      input.signal.throwIfAborted();
      const files: SolutionExportSupplementalFileV1[] = [];
      const add = (path: string, content: string, workloadId?: string) =>
        files.push(
          solutionExportSupplementalFileV1Schema.parse({
            path,
            content: { encoding: "utf8", value: content },
            checksum: sha256Digest(content),
            semanticChecksum: canonicalSemanticDigest(
              path.endsWith(".md") ? "text/markdown" : "text/javascript",
              new TextEncoder().encode(content),
            ),
            kind: "regular-file",
            mediaType: path.endsWith(".md")
              ? "text/markdown"
              : "text/javascript",
            ownership: "ai-generated-review-required",
            provenance: {
              producer,
              solutionRevisionId: input.request.subject.solutionRevisionId,
              sourceReferences: [
                {
                  kind: "solution-revision",
                  id: input.request.subject.solutionRevisionId,
                },
                ...(workloadId ? [{ kind: "workload", id: workloadId }] : []),
              ],
            },
          }),
        );
      const index = [
        "# AI-generated application source",
        "",
        "Review required. These source and test files have not been executed or built by CloudMarkup. The infrastructure-only revision assessment remains unchanged. No Lambda deployment artifact or automatic infrastructure binding is produced.",
        "",
        "Generated from immutable revision " +
          input.request.subject.solutionRevisionId +
          " (" +
          input.request.subject.manifestDigest +
          ").",
        "Model: " +
          BETA_APPLICATION_SOURCE_MODEL_ID +
          ". Prompt version: " +
          promptVersion +
          ". Context digest: " +
          contextDigest +
          ".",
        "",
        "Review dependencies and business rules, install the specific AWS SDK v3 modules imported by the source in your own isolated development environment, run node --test index.test.mjs, then build/package and configure the Lambda handler index.handler. Supply environment bindings below using the referenced resources' deployed names or URLs. This folder does not change generated IAM or IaC.",
        "",
      ];
      for (const workload of response.workloads) {
        const selected = context.workloads.find(
          (w) => w.workloadId === workload.workloadId,
        );
        if (!selected)
          throw new Error("Generated workload has no matching context.");
        const folder =
          "workload-" + sha256Digest(workload.workloadId).slice(7, 23);
        const root = "application/ai-drafts/" + folder;
        add(root + "/index.mjs", workload.handler, workload.workloadId);
        add(root + "/index.test.mjs", workload.tests, workload.workloadId);
        const bindings = selected.environmentBindings
          .map(
            (b) =>
              b.variable +
              " → resource " +
              b.nodeId +
              " (" +
              b.relationshipType +
              ")",
          )
          .join("\n");
        add(
          root + "/README.md",
          "# " +
            workload.workloadId +
            "\n\nAI-generated draft. Review and run tests before use.\n\n" +
            workload.notes +
            ("review" in workload
              ? "\n\n## AI review — advisory, not execution evidence\n\n" +
                workload.review.purposeCoverage +
                "\n\n### Configuration checks\n\n" +
                workload.review.configurationChecks
                  .map((note) => "- " + note)
                  .join("\n") +
                "\n\n### Risks and unresolved decisions\n\n" +
                (workload.review.risks.map((note) => "- " + note).join("\n") ||
                  "No additional risks were identified by the model; human review is still required.") +
                "\n\n### Test plan to run in your environment\n\n" +
                workload.review.testPlan.map((note) => "- " + note).join("\n")
              : "") +
            "\n\n## Required environment bindings\n\n" +
            (bindings || "No outbound resource bindings were identified.") +
            "\n",
          workload.workloadId,
        );
        index.push("- " + workload.workloadId + ": " + folder + "/index.mjs");
      }
      add("application/ai-drafts/README.md", index.join("\n") + "\n");
      return files;
    },
  };
}
