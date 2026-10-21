import type { ArchitectureDocument } from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import type { EditorCatalog } from "./editor-catalog.js";
import { resolveExactEditorCatalogService } from "./catalog-selection.js";

/** Explicit infrastructure intent, shared by creation and reviewed recovery. */
export function prepareInfrastructureWorkloadCommand(input: {
  readonly document: ArchitectureDocument;
  readonly catalog: EditorCatalog;
  readonly nodeId: string;
  readonly createId: () => string;
}) {
  const node = input.document.nodes.find(({ id }) => id === input.nodeId);
  if (
    node === undefined ||
    resolveExactEditorCatalogService(input.document, node, input.catalog)
      ?.defaultWorkload !== "infrastructure-only"
  )
    throw new Error(
      "Infrastructure-only setup is unavailable for this resource.",
    );
  if (node.semantic.lifecycle.ownership !== "user")
    throw new Error(
      "Review ownership before changing this resource's implementation.",
    );
  if (
    input.document.workloadBehavior.workloads.some(
      ({ owningNodeId }) => owningNodeId === node.id,
    )
  )
    throw new Error(
      "This resource already has implementation intent. Review its current settings.",
    );
  const workloadId = "workload_" + node.id;
  if (
    input.document.workloadBehavior.workloads.some(
      ({ id }) => id === workloadId,
    )
  )
    throw new Error("The workload identity is already in use.");
  const workloadCommand = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: input.createId(),
    inverseCommandId: input.createId(),
    origin: "user",
    target: {
      architectureId: input.document.architectureId,
      documentId: input.document.documentId,
      revisionId: input.document.revision.revisionId,
    },
    kind: "replace-workload-and-application-contracts",
    expectedWorkloadBehavior: input.document.workloadBehavior,
    expectedApplicationContracts: input.document.applicationContracts,
    applicationContracts: input.document.applicationContracts,
    workloadBehavior: {
      ...input.document.workloadBehavior,
      workloads: [
        ...input.document.workloadBehavior.workloads,
        {
          id: workloadId,
          owningNodeId: node.id,
          implementation: { mode: "infrastructure-only" },
          operations: [],
          triggers: [],
          downstreamActions: [],
          environment: [],
          behaviorContracts: [],
          errorBehavior: { mode: "fail-invocation" },
          executionAssumptions: {
            timeout: { kind: "unresolved" },
            retry: { kind: "unresolved" },
          },
          triggerDispatch: { mode: "single" },
          unresolvedRequirementIds: [],
          entrypoints: [],
          httpRoutes: [],
          eventBindings: [],
          schedules: [],
          dataBindings: [],
          authorization: [],
          idempotency: [],
          observability: { signals: [], healthChecks: [], smokeTests: [] },
          tests: [],
          sourceOwnership: [],
          extensionPoints: [],
          extensions: [],
          implementationRequirements: [],
          compatibility: { applicationGenerators: [], modelGateways: [] },
          provenance: {
            source: "deterministic-generator",
            generatorId: "cloudmarkup.editor.infrastructure-workload",
            generatorVersion: "1.0.0",
            inputDigest: digestCanonicalValue({
              catalog: input.catalog.identity,
              nodeId: node.id,
              serviceType: node.semantic.serviceType,
            }),
          },
        },
      ],
    },
  });
  if (workloadCommand.kind !== "replace-workload-and-application-contracts")
    throw new TypeError("Expected workload command.");

  return workloadCommand;
}
