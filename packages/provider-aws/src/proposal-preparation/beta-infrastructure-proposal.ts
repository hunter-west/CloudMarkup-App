import { prepareConfigurationCommand } from "@cloudmarkup/graph-preparation/configuration-command";
import { betaInfrastructureIssueIdentity } from "@cloudmarkup/graph-preparation/validation-finding-identity";
import { prepareEventWorkloadBinding } from "@cloudmarkup/graph-preparation/event-workload-binding";
import {
  defaultPurposeOperationId,
  prepareWorkloadOperationCommand,
} from "@cloudmarkup/graph-preparation/workload-operation-command";
import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
  type ValidationFinding,
} from "@cloudmarkup/domain";
import {
  betaInfrastructureProposalSchema,
  digestCanonicalValue,
  serviceConfigurationRecordSchema,
  parseGraphCommandV1,
  type GraphCommandActionV1,
  type GraphCommandV1,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { isReviewedLiteralConfigurationPropertyV1 } from "@cloudmarkup/provider-sdk";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { awsOwnedPolicyGraphDescriptors } from "./aws-owned-policy-descriptors.js";
import { prepareUserOwnedConfigurationCreate } from "@cloudmarkup/graph-preparation/owned-policy-commands";
import { hasExactEditorCatalogBinding } from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  createAddServiceCommand,
  createStableServiceNodeIdentity,
} from "@cloudmarkup/graph-preparation/add-service-command";
import type { EditorCatalog } from "@cloudmarkup/graph-preparation/editor-catalog";
import type { PreparedResourceRepair } from "@cloudmarkup/graph-preparation/resource-repair-command";

/** Model output has no command authority. Build a complete preview with the same
 * catalog creation, relationship resolver and atomic engine used by the editor. */
export function prepareBetaInfrastructureProposal(input: {
  readonly document: ArchitectureDocument;
  readonly catalog: EditorCatalog;
  readonly proposal: unknown;
  readonly createId: () => string;
  readonly selectedIssue?: ValidationFinding;
  readonly prepareLayout?: (
    document: ArchitectureDocument,
  ) => GraphCommandV1 | null;
}): PreparedResourceRepair {
  const proposal = betaInfrastructureProposalSchema.parse(input.proposal);
  if (proposal.contractVersion === 6) {
    const digest = digestCanonicalValue({
      architectureDigest: digestCanonicalValue(input.document),
      proposalDigest: digestCanonicalValue(proposal),
    });
    let ordinal = 0;
    input = {
      ...input,
      createId: () => `p_${digest.slice(-16)}_${String(++ordinal)}`,
    };
  }
  if ("review" in proposal && proposal.review.questions.length > 0)
    throw new Error(
      "Answer the clarification questions before requesting changes.",
    );
  if (
    "review" in proposal &&
    proposal.resources.length +
      proposal.connections.length +
      proposal.updates.length ===
      0
  )
    throw new Error("This assessment has no canvas changes to apply.");
  if (!hasExactEditorCatalogBinding(input.document, input.catalog))
    throw new Error("Upgrade the diagram catalog before requesting additions.");
  let document = input.document;
  const commands: GraphCommandActionV1[] = [];
  const append = (command: GraphCommandV1) => {
    document = applyGraphCommand(document, command).document;
    commands.push(...(command.kind === "batch" ? command.commands : [command]));
  };
  if (
    !document.nodes.some(
      (node) => node.semantic.serviceType === "aws.region.boundary",
    )
  ) {
    append(
      createAddServiceCommand({
        ...input,
        document,
        serviceId: "aws.region.boundary",
      }).command,
    );
  }
  const nodes = new Map<string, string>();
  if (proposal.contractVersion !== 1) {
    for (const reference of proposal.existingResources) {
      const node = document.nodes.find(
        (candidate) => candidate.id === reference.nodeId,
      );
      if (!node || node.semantic.lifecycle.ownership === "generated")
        throw new Error(
          "A referenced resource is unavailable. Request a fresh proposal.",
        );
      nodes.set(reference.key, node.id);
    }
  }
  if ("review" in proposal) {
    for (const update of proposal.updates) {
      const nodeId = nodes.get(update.resourceKey);
      const node = document.nodes.find((n) => n.id === nodeId);
      if (!node || node.semantic.lifecycle.ownership === "generated")
        throw new Error(
          "AI can only propose edits to referenced, user-owned resources.",
        );
      if (
        [
          "aws.iam.policy-document",
          "aws.iam.policy-statement",
          "aws.iam.policy-condition",
          "aws.iam.managed-policy-attachment",
        ].includes(node.semantic.serviceType)
      )
        throw new Error(
          "AI policy edits require a dedicated permissions review. Use the policy editor for this setting.",
        );
      const definition = awsCatalogV1.requireService(node.semantic.serviceType);
      const edits: Record<string, ConfigurationValue> = {};
      for (const [property, value] of Object.entries(update.configuration)) {
        if (
          !isReviewedLiteralConfigurationPropertyV1(
            definition.configuration,
            property,
          )
        )
          throw new Error(
            "The proposed setting is not available for AI editing.",
          );
        edits[property] = Array.isArray(value)
          ? { kind: "string-list", value }
          : typeof value === "number"
            ? {
                kind:
                  Object.entries(
                    definition.configuration.jsonSchema.properties,
                  ).find(([key]) => key === property)?.[1].type === "integer"
                    ? "integer"
                    : "number",
                value,
              }
            : typeof value === "boolean"
              ? { kind: "boolean", value }
              : { kind: "string", value };
      }
      append(
        prepareConfigurationCommand({
          document,
          catalog: input.catalog,
          createId: input.createId,
          target: { kind: "node", id: node.id },
          edits,
        }).command,
      );
    }
  }
  const pendingConnections = new Set(
    [...proposal.connections].sort(
      (a, b) =>
        Number(b.ruleId.includes("role-assumed-by")) -
        Number(a.ruleId.includes("role-assumed-by")),
    ),
  );
  const connectAvailable = () => {
    for (const connection of pendingConnections) {
      const rule = awsCatalogV1
        .listConnectionRules()
        .find((rule) => rule.id === connection.ruleId);
      const sourceId = nodes.get(connection.sourceKey),
        targetId = nodes.get(connection.targetKey);
      if (!rule) throw new Error("A proposed connection is unavailable.");
      if (!sourceId || !targetId) continue;
      const parent = document.nodes.find((node) => node.id === targetId)
        ?.semantic.parent;
      if (
        parent?.nodeId === sourceId &&
        parent.relationshipType === rule.relationshipType &&
        Object.keys(connection.configuration).length === 0 &&
        document.edges.some(
          (edge) =>
            edge.semantic.relationshipType === rule.relationshipType &&
            edge.semantic.source.nodeId === sourceId &&
            edge.semantic.target.nodeId === targetId,
        )
      ) {
        pendingConnections.delete(connection);
        continue;
      }
      const configuration = Object.create(null) as Record<
        string,
        ConfigurationValue
      >;
      for (const [property, value] of Object.entries(
        connection.configuration,
      )) {
        configuration[property] = Array.isArray(value)
          ? { kind: "string-list", value }
          : typeof value === "boolean"
            ? { kind: "boolean", value }
            : typeof value === "number"
              ? Object.entries(rule.configuration.jsonSchema.properties).find(
                  ([key]) => key === property,
                )?.[1].type === "integer"
                ? { kind: "integer", value }
                : { kind: "number", value }
              : { kind: "string", value };
      }
      const result = awsConnectionResolverV1.resolve({
        document,
        operationId: input.createId(),
        ruleId: rule.id,
        configuration,
        source: { nodeId: sourceId, portId: rule.source.portId },
        target: { nodeId: targetId, portId: rule.target.portId },
      });
      if (!result.success)
        throw new Error(
          result.findings[0]?.guidedMessage ??
            "A proposed connection needs more information.",
          { cause: { ruleId: rule.id, findings: result.findings } },
        );
      append(result.batch);
      pendingConnections.delete(connection);
    }
  };
  let ownedPhase = false;
  // Establish deployable resources and their execution-role bindings before
  // preparing owned configuration. The final command batch remains atomic.
  const orderedResources = [...proposal.resources].sort(
    (a, b) =>
      Number(
        input.catalog.services.find((s) => s.serviceType === a.serviceType)
          ?.deployable === false,
      ) -
      Number(
        input.catalog.services.find((s) => s.serviceType === b.serviceType)
          ?.deployable === false,
      ),
  );
  for (const resource of orderedResources) {
    if (
      !ownedPhase &&
      input.catalog.services.find((s) => s.serviceType === resource.serviceType)
        ?.deployable === false
    ) {
      connectAvailable();
      ownedPhase = true;
    }
    const parentNodeId =
      resource.parentKey === null ? undefined : nodes.get(resource.parentKey);
    if (resource.parentKey !== null && parentNodeId === undefined)
      throw new Error("A proposed parent is unavailable.");
    const configured =
      "configuration" in resource && resource.configuration !== undefined
        ? awsCatalogV1.validateConfiguration(
            resource.serviceType,
            Object.fromEntries(
              Object.entries(resource.configuration).map(([key, value]) => [
                key,
                {
                  kind: Array.isArray(value)
                    ? "string-list"
                    : typeof value === "number"
                      ? Object.entries(
                          awsCatalogV1.requireService(resource.serviceType)
                            .configuration.jsonSchema.properties,
                        ).find(([property]) => property === key)?.[1].type ===
                        "integer"
                        ? "integer"
                        : "number"
                      : typeof value,
                  value,
                },
              ]),
            ),
          )
        : undefined;
    if (configured !== undefined && !configured.success)
      throw new Error(
        "A proposed resource has invalid configuration. Request a fresh proposal.",
      );
    const create = () => {
      const service = input.catalog.services.find(
        (s) => s.serviceType === resource.serviceType,
      );
      if (service?.deployable !== false)
        return createAddServiceCommand({
          catalog: input.catalog,
          createId: input.createId,
          document,
          serviceId: resource.serviceType,
          ...(configured?.success
            ? { configurationValues: configured.values }
            : {}),
          ...(parentNodeId === undefined ? {} : { parentNodeId }),
        });
      if (proposal.contractVersion < 3 || parentNodeId === undefined)
        throw new Error("An owned resource requires its explicit owner.");
      const owner = document.nodes.find((node) => node.id === parentNodeId);
      const descriptors = awsOwnedPolicyGraphDescriptors;
      const slots = descriptors.ownedConfigurations.slots.filter(
        (slot) =>
          slot.ownerServiceType === owner?.semantic.serviceType &&
          slot.configurationKindIds.includes(resource.serviceType) &&
          (resource.serviceType !== "aws.iam.managed-policy-attachment" ||
            slot.id === "aws.iam.role.slot.managed-policy"),
      );
      const slot = slots[0];
      if (
        !slot ||
        slots.length !== 1 ||
        !owner ||
        (resource.serviceType.startsWith("aws.iam.") &&
          !(
            resource.serviceType === "aws.iam.managed-policy-attachment" &&
            "configuration" in resource &&
            resource.configuration?.["attachmentKind"] ===
              "managed-policy-attachment" &&
            resource.configuration["managedPolicyReference"] ===
              "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole"
          ))
      )
        throw new Error(
          "This owned resource is not available to the diagram assistant.",
        );
      const values =
        configured ??
        awsCatalogV1.validateConfiguration(resource.serviceType, {});
      if (!values.success)
        throw new Error("This owned resource needs valid configuration.");
      const identity = createStableServiceNodeIdentity(
        document,
        resource.serviceType,
      );
      const operation = () => ({
        commandId: input.createId(),
        inverseCommandId: input.createId(),
      });
      const prepared = prepareUserOwnedConfigurationCreate({
        descriptors,
        document,
        operationIdentities: {
          batch: operation(),
          actions: [operation(), operation()],
        },
        ownerNodeId: owner.id,
        slotId: slot.id,
        ownedKindId: resource.serviceType,
        ownedConfiguration: {
          ...identity,
          label: resource.label,
          position: {
            x: owner.presentation.position.x + 16,
            y: owner.presentation.position.y + 16,
          },
          configuration: serviceConfigurationRecordSchema.parse({
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: values.values,
          }),
        },
        ownerBindingEdgeId: input.createId(),
      });
      if (prepared.status !== "ready")
        throw new Error(
          "The proposed " +
            resource.label +
            " could not be prepared. Review its owner and settings.",
          { cause: prepared },
        );
      return { command: prepared.command, nodeId: identity.nodeId };
    };
    const prepared = create();
    const label = (action: GraphCommandActionV1) =>
      action.kind === "add-node" && action.node.id === prepared.nodeId
        ? {
            ...action,
            node: {
              ...action.node,
              presentation: {
                ...action.node.presentation,
                label: resource.label,
              },
            },
          }
        : action;
    append(
      parseGraphCommandV1(
        prepared.command.kind === "batch"
          ? {
              ...prepared.command,
              commands: prepared.command.commands.map(label),
            }
          : label(prepared.command),
      ),
    );
    nodes.set(resource.key, prepared.nodeId);
    if (ownedPhase) connectAvailable();
    if ("purpose" in resource && typeof resource.purpose === "string") {
      const workload = document.workloadBehavior.workloads.find(
        (workload) => workload.owningNodeId === prepared.nodeId,
      );
      if (workload)
        append(
          prepareWorkloadOperationCommand({
            document,
            workloadId: workload.id,
            operationId: defaultPurposeOperationId(workload),
            commandId: input.createId(),
            inverseCommandId: input.createId(),
            draft: {
              displayName: resource.label,
              description: resource.purpose,
              inputFields: "",
              outputFields: "",
            },
          }).command,
        );
    }
  }
  connectAvailable();
  if (pendingConnections.size > 0)
    throw new Error("A proposed connection refers to an unavailable resource.");

  if (proposal.contractVersion >= 3) {
    // The model only proposes resources and edges. Bind reviewed event edges to
    // the exact workload operation after all edges have stable graph identities.
    const eventRules = awsCatalogV1
      .listConnectionRules()
      .filter((rule) => rule.category === "receives-events-from");
    const existingEdgeIds = new Set(
      input.document.edges.map((edge) => edge.id),
    );
    const eventEdges = document.edges.filter((edge) => {
      if ("review" in proposal && existingEdgeIds.has(edge.id)) return false;
      const source = document.nodes.find(
        (node) => node.id === edge.semantic.source.nodeId,
      );
      const target = document.nodes.find(
        (node) => node.id === edge.semantic.target.nodeId,
      );
      return eventRules.some(
        (rule) =>
          rule.relationshipType === edge.semantic.relationshipType &&
          rule.source.serviceId === source?.semantic.serviceType &&
          rule.target.serviceId === target?.semantic.serviceType &&
          rule.source.portId === edge.semantic.source.port &&
          rule.target.portId === edge.semantic.target.port,
      );
    });
    const bind = prepareEventWorkloadBinding(
      document,
      eventEdges,
      input.createId,
    );
    if (bind !== null) append(bind);
    const report = executeArchitectureValidationRules(
      { document, environment: "development", target: "draft" },
      awsValidationRulesV1,
    );
    if (report.diagnostics.length > 0)
      throw new Error(
        "The proposed design could not be fully checked. Request a fresh proposal.",
      );
    const baseline =
      "review" in proposal
        ? executeArchitectureValidationRules(
            {
              document: input.document,
              environment: "development",
              target: "draft",
            },
            awsValidationRulesV1,
          )
        : null;
    if (baseline && baseline.evaluationStatus !== "complete")
      throw new Error(
        "The current design could not be fully checked. Resolve validation before requesting AI edits.",
      );
    const fingerprint = (finding: (typeof report.findings)[number]) =>
      JSON.stringify([
        finding.severity,
        betaInfrastructureIssueIdentity(finding),
      ]);
    const selectedIssueIdentity = input.selectedIssue
      ? betaInfrastructureIssueIdentity(input.selectedIssue)
      : null;
    if (
      selectedIssueIdentity &&
      report.findings.some(
        (finding) =>
          betaInfrastructureIssueIdentity(finding) === selectedIssueIdentity,
      )
    )
      throw new Error(
        "The proposed change does not resolve the selected issue. Review the affected settings and request a corrected proposal.",
      );
    const existingErrors = new Set(baseline?.findings.map(fingerprint));
    const blocking = report.findings.filter(
      (finding) =>
        (finding.severity === "error" ||
          finding.severity === "security-error") &&
        !existingErrors.has(fingerprint(finding)),
    );
    if (blocking.length > 0)
      throw new Error(
        "The proposed design needs correction before it can be used: " +
          blocking
            .slice(0, 3)
            .map((finding) => finding.title)
            .join("; ") +
          (blocking.length > 3 ? "; and more." : ".") +
          " Update the request or retry the proposal.",
      );
  }
  // V6 proof and browser application must have identical commands/results.
  // Presentation layout remains the legacy web host's separate concern.
  const layout =
    proposal.contractVersion === 6 ? null : input.prepareLayout?.(document);
  if (layout) append(layout);
  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: input.createId(),
    inverseCommandId: input.createId(),
    origin: "user",
    target: {
      architectureId: input.document.architectureId,
      documentId: input.document.documentId,
      revisionId: input.document.revision.revisionId,
    },
    kind: "batch",
    commands,
  });
  const result = applyGraphCommand(input.document, command);
  return {
    command,
    beforeHashes: getArchitectureDocumentHashes(input.document),
    previewHashes: getArchitectureDocumentHashes(result.document),
    label: "Apply AI infrastructure proposal",
    description: proposal.summary,
  };
}
