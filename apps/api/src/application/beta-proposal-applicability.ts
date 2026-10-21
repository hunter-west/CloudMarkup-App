import { z } from "zod";
import {
  architectureDocumentV3Schema,
  betaInfrastructureProposalV6Schema,
  betaInfrastructureSelectedIssueV1Schema,
  digestCanonicalValue,
  betaProposalApplicabilityReceiptV1Schema,
  type GraphCommandV1,
} from "@cloudmarkup/schemas";
import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  getArchitectureDocumentHashes,
  type ValidationFinding,
} from "@cloudmarkup/domain";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { aiSemanticContextV3Schema } from "./ai-semantic-context.js";

export function selectedIssueIdentity(
  input: z.infer<typeof betaInfrastructureSelectedIssueV1Schema>,
) {
  return JSON.stringify([
    input.code,
    input.affected
      .map((item) => [
        item.edgeId ? `edge:${item.edgeId}` : `node:${item.nodeId ?? ""}`,
        item.fieldPath,
      ])
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  ]);
}
export function betaProposalFindingIdentity(finding: ValidationFinding) {
  return JSON.stringify([
    finding.code,
    finding.affected
      .map((item) => {
        const owner = item.kind === "configuration" ? item.owner : item;
        return [
          "edgeId" in owner
            ? `edge:${owner.edgeId}`
            : "nodeId" in owner
              ? `node:${owner.nodeId}`
              : "document",
          item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
        ];
      })
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  ]);
}
export function assertSelectedIssueSupportedV6(
  document: z.infer<typeof architectureDocumentV3Schema>,
  selected: z.infer<typeof betaInfrastructureSelectedIssueV1Schema>,
) {
  const report = executeArchitectureValidationRules(
    { document, environment: "development", target: "draft" },
    awsValidationRulesV1,
  );
  const finding = report.findings.find(
    (item) =>
      betaProposalFindingIdentity(item) === selectedIssueIdentity(selected),
  );
  if (report.evaluationStatus !== "complete" || !finding)
    throw new Error(
      "The selected issue is stale or cannot be fully validated.",
    );
  const locations = finding.affected.filter(
    (item) => item.kind === "configuration",
  );
  if (
    finding.affected.some((item) => {
      const owner = item.kind === "configuration" ? item.owner : item;
      return (
        "nodeId" in owner &&
        document.nodes.some(
          (node) =>
            node.id === owner.nodeId &&
            [
              "aws.iam.policy-document",
              "aws.iam.policy-statement",
              "aws.iam.policy-condition",
              "aws.iam.managed-policy-attachment",
            ].includes(node.semantic.serviceType),
        )
      );
    })
  )
    throw new Error(
      "Use the dedicated permissions editor for this issue; AI policy edits remain unsupported.",
    );
  if (locations.length && locations.every((item) => item.owner.kind === "edge"))
    throw new Error(
      "Use the existing connection editor for this issue; AI connection updates remain unsupported.",
    );
  if (
    locations.some((location) => {
      if (location.owner.kind !== "node") return false;
      const nodeId = location.owner.nodeId;
      const node = document.nodes.find((item) => item.id === nodeId);
      if (!node) return true;
      const key = location.path.slice(location.path.lastIndexOf(".") + 1);
      return (
        node.semantic.lifecycle.ownership === "generated" ||
        awsCatalogV1
          .requireService(node.semantic.serviceType)
          .configuration.uiHints.some(
            (hint) => hint.property === key && hint.valueSource !== "literal",
          )
      );
    })
  )
    throw new Error(
      "Use the dedicated configuration editor for generated or reference settings; AI literal updates cannot repair this issue.",
    );
  return finding;
}

/** Host-injected preparer must use reviewed catalog/resolver/domain commands.
 * A model, caller-supplied command or receipt is never a preparer. This port
 * permits sharing the browser's deterministic adapter without importing React. */
export interface BetaProposalCommandPreparerV1 {
  prepare(input: {
    document: z.infer<typeof architectureDocumentV3Schema>;
    proposal: z.infer<typeof betaInfrastructureProposalV6Schema>;
    createId: () => string;
  }): GraphCommandV1;
}

/** Independent host proof runs before publication or success delivery.
 * Questions retain existing paid-response treatment; no pricing/meter mutation. */
export function admitBetaProposalV6(input: {
  document: unknown;
  proposal: unknown;
  context: unknown;
  architectureDigest: string;
  selectedIssue?: z.infer<typeof betaInfrastructureSelectedIssueV1Schema>;
  preparer: BetaProposalCommandPreparerV1;
}) {
  const document = architectureDocumentV3Schema.parse(input.document);
  const proposal = betaInfrastructureProposalV6Schema.parse(input.proposal);
  const context = aiSemanticContextV3Schema.parse(input.context);
  if (
    digestCanonicalValue(document) !== input.architectureDigest ||
    document.catalog.digest !== context.catalog.digest ||
    getArchitectureDocumentHashes(document).contentHash !==
      context.semanticDigest
  )
    throw new Error(
      "Applicability proof requires the exact admitted saved baseline.",
    );
  const baseline = executeArchitectureValidationRules(
    { document, environment: "development", target: "draft" },
    awsValidationRulesV1,
  );
  if (baseline.evaluationStatus !== "complete" || baseline.diagnostics.length)
    throw new Error("Applicability baseline validation is incomplete.");
  const selected = input.selectedIssue
    ? selectedIssueIdentity(input.selectedIssue)
    : undefined;
  if (
    selected &&
    !baseline.findings.some(
      (finding) => betaProposalFindingIdentity(finding) === selected,
    )
  )
    throw new Error(
      "The selected issue no longer exists on the admitted baseline.",
    );
  const mutation =
    proposal.resources.length +
      proposal.connections.length +
      proposal.updates.length >
    0;
  if (selected && !mutation && proposal.review.questions.length === 0)
    throw new Error(
      "The selected issue is unresolved; provide an applicable repair or substantive clarification questions.",
    );
  const proposalDigest = digestCanonicalValue(proposal);
  let command: GraphCommandV1 | undefined;
  let result = document;
  if (mutation) {
    for (const update of proposal.updates) {
      const nodeId = proposal.existingResources.find(
        (item) => item.key === update.resourceKey,
      )?.nodeId;
      const node = document.nodes.find((item) => item.id === nodeId);
      if (
        !node ||
        node.semantic.lifecycle.ownership === "generated" ||
        [
          "aws.iam.policy-document",
          "aws.iam.policy-statement",
          "aws.iam.policy-condition",
          "aws.iam.managed-policy-attachment",
        ].includes(node.semantic.serviceType) ||
        Object.keys(update.configuration).some((key) => {
          const value = Object.entries(node.semantic.configuration.values).find(
            ([name]) => name === key,
          )?.[1];
          return (
            value &&
            [
              "node-reference",
              "variable-reference",
              "secret-reference",
            ].includes(value.kind)
          );
        })
      )
        throw new Error(
          "Applicability admission cannot edit policies, generated resources or reference settings.",
        );
    }
    let ordinal = 0;
    const identityDigest = digestCanonicalValue({
      architectureDigest: input.architectureDigest,
      proposalDigest,
    });
    command = input.preparer.prepare({
      document: structuredClone(document),
      proposal,
      createId: () => `p_${identityDigest.slice(-16)}_${String(++ordinal)}`,
    });
    result = applyGraphCommand(document, command).document;
    const report = executeArchitectureValidationRules(
      { document: result, environment: "development", target: "draft" },
      awsValidationRulesV1,
    );
    const blockers = new Set(
      baseline.findings
        .filter((finding) =>
          ["error", "security-error"].includes(finding.severity),
        )
        .map((finding) =>
          JSON.stringify([
            finding.severity,
            betaProposalFindingIdentity(finding),
          ]),
        ),
    );
    // An edit of a field implicated in an existing blocking finding must resolve
    // that finding, even if a general request omitted a selected-issue identity.
    const touched = new Map(
      proposal.updates.map((update) => [
        proposal.existingResources.find(
          (item) => item.key === update.resourceKey,
        )?.nodeId,
        new Set(Object.keys(update.configuration)),
      ]),
    );
    const unresolvedTouched = baseline.findings.some(
      (finding) =>
        ["error", "security-error"].includes(finding.severity) &&
        finding.affected.some(
          (location) =>
            location.kind === "configuration" &&
            location.owner.kind === "node" &&
            touched
              .get(location.owner.nodeId)
              ?.has(location.path.slice(location.path.lastIndexOf(".") + 1)),
        ) &&
        report.findings.some(
          (item) =>
            betaProposalFindingIdentity(item) ===
            betaProposalFindingIdentity(finding),
        ),
    );
    if (
      report.evaluationStatus !== "complete" ||
      report.diagnostics.length ||
      unresolvedTouched ||
      report.findings.some(
        (finding) =>
          ["error", "security-error"].includes(finding.severity) &&
          !blockers.has(
            JSON.stringify([
              finding.severity,
              betaProposalFindingIdentity(finding),
            ]),
          ),
      ) ||
      (selected &&
        report.findings.some(
          (finding) => betaProposalFindingIdentity(finding) === selected,
        ))
    )
      throw new Error(
        "The proposal is not applicable or leaves its selected issue unresolved.",
      );
  }
  return betaProposalApplicabilityReceiptV1Schema.parse({
    contractVersion: 1,
    validatorVersion: "beta-applicability-v1",
    architectureDigest: input.architectureDigest,
    catalogDigest: document.catalog.digest,
    proposalDigest,
    resultDigest: digestCanonicalValue(result),
    commandDigest: command ? digestCanonicalValue(command) : null,
    kind: mutation ? "mutation" : "questions-or-assessment",
  });
}
