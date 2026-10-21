import { describe, expect, it, vi } from "vitest";
import { executeArchitectureValidationRules } from "@cloudmarkup/domain";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import {
  digestCanonicalValue,
  parseGraphCommandV1,
  betaInfrastructureSelectedIssueV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobDraftSubjectV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  architectureProposalJobInputV1Schema,
} from "@cloudmarkup/schemas";
import { betaInfrastructureProposalResponseV1Schema } from "@cloudmarkup/api-contract";
import { projectAiSemanticContextV3 } from "./ai-semantic-context.js";
import { currentAiCanvasIssueFixture } from "./ai-canvas-context-test-helpers.js";
import {
  admitBetaProposalV6,
  assertSelectedIssueSupportedV6,
  type BetaProposalCommandPreparerV1,
} from "./beta-proposal-applicability.js";
import { preparedBetaInfrastructureInputSchema } from "./beta-infrastructure.js";
import {
  assertBoundBetaProposalInput,
  parseBoundBetaProposalResult,
} from "./beta-proposal-result-binding.js";
import { betaProposalCommandPreparerV1 } from "./beta-proposal-command-preparer.js";
import { createProductionInitialDocument } from "../production-initial-document.js";

export function applicabilityFixture() {
  const document = currentAiCanvasIssueFixture();
  const report = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    awsValidationRulesV1,
  );
  const finding = report.findings.find(
    (item) => item.code === "aws.validation.sqs-visibility-timeout-conflict",
  );
  if (!finding) throw new Error("Missing deterministic queue finding.");
  const selectedIssue = betaInfrastructureSelectedIssueV1Schema.parse({
    code: finding.code,
    affected: finding.affected.map((item) => {
      const owner = item.kind === "configuration" ? item.owner : item;
      return {
        ...("nodeId" in owner ? { nodeId: owner.nodeId } : {}),
        ...("edgeId" in owner ? { edgeId: owner.edgeId } : {}),
        fieldPath: item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
      };
    }),
  });
  const proposal = {
    contractVersion: 6 as const,
    summary: "Repair queue visibility.",
    resources: [],
    connections: [],
    existingResources: [{ key: "queue", nodeId: "node_affected_queue" }],
    updates: [
      {
        resourceKey: "queue",
        configuration: { visibilityTimeoutSeconds: 120 },
        reason: "Exceed the handler timeout.",
      },
    ],
    limitations: [],
    review: {
      intent: "Resolve queue visibility",
      assumptions: [],
      checks: ["Compared handler and queue settings"],
      questions: [],
    },
  };
  const preparer: BetaProposalCommandPreparerV1 = {
    prepare(input) {
      const node = input.document.nodes.find(
        (item) => item.id === "node_affected_queue",
      );
      if (!node) throw new Error("Missing queue.");
      const value =
        input.proposal.updates[0]?.configuration["visibilityTimeoutSeconds"];
      if (typeof value !== "number") throw new Error("Missing numeric repair.");
      return parseGraphCommandV1({
        schemaVersion: 1,
        commandId: input.createId(),
        inverseCommandId: input.createId(),
        origin: "user",
        target: {
          architectureId: input.document.architectureId,
          documentId: input.document.documentId,
          revisionId: input.document.revision.revisionId,
        },
        kind: "update-node-configuration",
        nodeId: node.id,
        expectedConfiguration: node.semantic.configuration,
        configuration: {
          ...node.semantic.configuration,
          values: {
            ...node.semantic.configuration.values,
            visibilityTimeoutSeconds: { kind: "integer", value },
          },
        },
      });
    },
  };
  return {
    document,
    proposal,
    selectedIssue,
    preparer,
    context: projectAiSemanticContextV3(document, selectedIssue),
    architectureDigest: digestCanonicalValue(document),
  };
}

describe("host applicability admission", () => {
  it("admits unfiltered SNS-to-SQS delivery while retaining the filter-value guard", () => {
    const document = createProductionInitialDocument({
      identity: {
        architectureId: "architecture_topic_delivery",
        documentId: "document_topic_delivery",
        draftId: "draft_topic_delivery",
        revisionId: "revision_topic_delivery",
        principalId: "principal_topic_delivery",
      },
      createdAt: "2026-10-16T00:00:00.000Z",
      blank: true,
      infrastructureOnly: true,
    });
    const proposal = {
      contractVersion: 6,
      summary: "Topic delivery",
      resources: [
        {
          key: "topic",
          serviceType: "aws.sns.topic",
          label: "Events",
          parentKey: null,
        },
        {
          key: "queue",
          serviceType: "aws.sqs.queue",
          label: "Delivery",
          parentKey: null,
        },
        {
          key: "subscription",
          serviceType: "aws.sns.subscription",
          label: "Queue subscription",
          parentKey: "topic",
          configuration: {
            protocol: "SQS",
            filterScope: "NONE",
            filterKeys: [],
          },
        },
      ],
      existingResources: [],
      connections: [
        {
          ruleId: "aws.sns.subscription-sends-to-sqs",
          sourceKey: "subscription",
          targetKey: "queue",
          configuration: {},
        },
      ],
      updates: [],
      limitations: [],
      review: {
        intent: "Deliver topic messages to the queue.",
        assumptions: [],
        checks: ["Review the queue subscription before applying."],
        questions: [],
      },
    };
    const input = {
      document,
      proposal,
      context: projectAiSemanticContextV3(document),
      architectureDigest: digestCanonicalValue(document),
      preparer: betaProposalCommandPreparerV1,
    };
    expect(admitBetaProposalV6(input).kind).toBe("mutation");
    expect(() =>
      admitBetaProposalV6({
        ...input,
        proposal: {
          ...proposal,
          resources: proposal.resources.map((resource) =>
            resource.key === "subscription"
              ? {
                  ...resource,
                  configuration: {
                    protocol: "SQS",
                    filterScope: "MESSAGE_ATTRIBUTES",
                    filterKeys: ["category"],
                  },
                }
              : resource,
          ),
        },
      }),
    ).toThrow("Additional event filters need a supported typed value contract");
  });
  it("uses the reviewed editor engine for real repair and rejects invalid model repairs without synthetic command authority", () => {
    const f = applicabilityFixture();
    const receipt = admitBetaProposalV6({
      ...f,
      preparer: betaProposalCommandPreparerV1,
    });
    expect(receipt.kind).toBe("mutation");
    expect(
      admitBetaProposalV6({ ...f, preparer: betaProposalCommandPreparerV1 }),
    ).toEqual(receipt);
    expect(() =>
      admitBetaProposalV6({
        ...f,
        preparer: betaProposalCommandPreparerV1,
        proposal: {
          ...f.proposal,
          updates: [
            {
              ...f.proposal.updates[0],
              configuration: { visibilityTimeoutSeconds: 30 },
            },
          ],
        },
      }),
    ).toThrow("unresolved");
  });
  it("classifies policy-owner issues as manual before inference and keeps policy mutation forbidden", () => {
    const f = applicabilityFixture();
    const issue = f.context.validation.findings.find(
      (item) => item.code === "aws.validation.iam-policy-owner-invalid",
    );
    if (!issue?.affectedEntities)
      throw new Error("Missing synthetic policy finding.");
    const selected = betaInfrastructureSelectedIssueV1Schema.parse({
      code: issue.code,
      affected: issue.affectedEntities.map((item) => ({
        ...(item.nodeId ? { nodeId: item.nodeId } : {}),
        ...(item.edgeId ? { edgeId: item.edgeId } : {}),
        fieldPath: item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
      })),
    });
    expect(() => assertSelectedIssueSupportedV6(f.document, selected)).toThrow(
      "permissions editor",
    );
    const proposal = {
      ...f.proposal,
      existingResources: [{ key: "queue", nodeId: "node_hidden_policy" }],
      updates: [
        {
          resourceKey: "queue",
          configuration: { policyKind: "trust" },
          reason: "Unapproved policy change",
        },
      ],
    };
    expect(() => admitBetaProposalV6({ ...f, proposal })).toThrow(
      "cannot edit policies",
    );
  });
  it("binds both fresh publication and retained replay to the exact input/catalog/version", () => {
    const f = applicabilityFixture();
    const input = preparedBetaInfrastructureInputSchema.parse({
      contractVersion: 1,
      proposalVersion: 6,
      requirements: "Resolve queue visibility",
      modelInputBytes: 10000,
      architectureDigest: f.architectureDigest,
      savedArchitectureDigest: f.architectureDigest,
      catalogDigest: f.document.catalog.digest,
      configurationProjectionVersion: 2,
      existingArchitecture: f.context,
      selectedIssue: f.selectedIssue,
      validationOwnership: {
        organizationId: "org_test",
        projectId: "project_test",
      },
      validationSubject: {
        kind: "draft",
        draftId: "draft_test",
        draftVersion: 1,
        etag: '"draft:1"',
        contentDigest: f.architectureDigest,
      },
    });
    const output = {
      contractVersion: 1,
      architectureDigest: f.architectureDigest,
      proposal: f.proposal,
      applicability: admitBetaProposalV6(f),
    };
    const record = {
      ownership: asyncJobTrustedOwnershipV1Schema.parse({
        organizationId: "org_test",
        projectId: "project_test",
      }),
      input: architectureProposalJobInputV1Schema.parse({
        contractVersion: 1 as const,
        family: "architecture-proposal" as const,
        subject: asyncJobDraftSubjectV1Schema.parse({
          kind: "draft",
          draftId: "draft_test",
          draftVersion: 1,
          etag: '"draft:1"',
          contentDigest: f.architectureDigest,
        }),
        intentDocument: asyncJobObjectReferenceV1Schema.parse({
          contractVersion: 1,
          objectId: "object_test",
          purpose: "input-payload",
          digest: digestCanonicalValue(input),
          sizeBytes: 10000,
          mediaType: "application/json",
        }),
      }),
    };
    expect(() => {
      assertBoundBetaProposalInput(input, record);
    }).not.toThrow();
    expect(() => {
      assertBoundBetaProposalInput(input, {
        ...record,
        ownership: asyncJobTrustedOwnershipV1Schema.parse({
          ...record.ownership,
          organizationId: "org_other",
        }),
      });
    }).toThrow("authority");
    expect(() => {
      assertBoundBetaProposalInput(input, {
        ...record,
        input: {
          ...record.input,
          subject: { ...record.input.subject, draftVersion: 2 },
        },
      });
    }).toThrow("authority");
    expect(parseBoundBetaProposalResult(input, output)).toEqual(output);
    expect(() =>
      parseBoundBetaProposalResult(
        { ...input, architectureDigest: digestCanonicalValue("other") },
        output,
      ),
    ).toThrow("immutable");
    expect(() =>
      parseBoundBetaProposalResult(
        { ...input, catalogDigest: digestCanonicalValue("other") },
        output,
      ),
    ).toThrow("immutable");
    expect(() =>
      parseBoundBetaProposalResult({ ...input, proposalVersion: 5 }, output),
    ).toThrow("immutable");
  });
  it("rejects a plausible same-fingerprint false repair, independently of preview checks", () => {
    const f = applicabilityFixture();
    const proposal = {
      ...f.proposal,
      updates: [
        {
          ...f.proposal.updates[0],
          configuration: { visibilityTimeoutSeconds: 30 },
        },
      ],
    };
    expect(() => admitBetaProposalV6({ ...f, proposal })).toThrow("unresolved");
    expect(() =>
      admitBetaProposalV6({
        document: f.document,
        context: f.context,
        architectureDigest: f.architectureDigest,
        preparer: f.preparer,
        proposal,
      }),
    ).toThrow("unresolved");
  });
  it("accepts a deterministic real repair while preserving unrelated existing findings and original graph", () => {
    const f = applicabilityFixture();
    const before = digestCanonicalValue(f.document);
    const receipt = admitBetaProposalV6(f);
    expect(receipt).toMatchObject({
      kind: "mutation",
      architectureDigest: before,
      proposalDigest: digestCanonicalValue(f.proposal),
    });
    expect(receipt.commandDigest).not.toBeNull();
    expect(receipt.resultDigest).not.toBe(before);
    expect(admitBetaProposalV6(f)).toEqual(receipt);
    expect(digestCanonicalValue(f.document)).toBe(before);
  });
  it("keeps substantive questions as accepted paid-response data without invoking mutation preparation", () => {
    const f = applicabilityFixture();
    const prepare = vi.fn(() => {
      throw new Error("Must not mutate a question.");
    });
    const proposal = {
      ...f.proposal,
      updates: [],
      review: {
        ...f.proposal.review,
        questions: ["Which timeout does the workload require?"],
      },
    };
    const receipt = admitBetaProposalV6({
      ...f,
      proposal,
      preparer: { prepare },
    });
    expect(receipt.kind).toBe("questions-or-assessment");
    expect(receipt.commandDigest).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("refuses empty selected-issue repair claims while retaining general paid assessments", () => {
    const f = applicabilityFixture();
    const proposal = {
      ...f.proposal,
      updates: [],
      summary: "The issue is fixed.",
    };
    expect(() => admitBetaProposalV6({ ...f, proposal })).toThrow("unresolved");
    const { selectedIssue, ...general } = f;
    expect(selectedIssue.code).toContain("visibility");
    expect(
      admitBetaProposalV6({
        ...general,
        proposal: {
          ...proposal,
          summary: "Review existing findings before export.",
        },
      }).kind,
    ).toBe("questions-or-assessment");
  });
  it("rejects stale baseline, tampered semantic context and stale selected issue", () => {
    const f = applicabilityFixture();
    expect(() =>
      admitBetaProposalV6({
        ...f,
        architectureDigest: digestCanonicalValue("other"),
      }),
    ).toThrow("baseline");
    expect(() =>
      admitBetaProposalV6({
        ...f,
        context: {
          ...f.context,
          semanticDigest: digestCanonicalValue("other"),
        },
      }),
    ).toThrow("baseline");
    expect(() =>
      admitBetaProposalV6({
        ...f,
        selectedIssue: { ...f.selectedIssue, code: "unknown.issue" },
      }),
    ).toThrow("selected issue");
  });
  it("rejects output without a matching host receipt before publication or retained replay", () => {
    const f = applicabilityFixture();
    const result = {
      contractVersion: 1,
      architectureDigest: f.architectureDigest,
      proposal: f.proposal,
    };
    expect(
      betaInfrastructureProposalResponseV1Schema.shape.data.safeParse(result)
        .success,
    ).toBe(false);
    const applicability = admitBetaProposalV6(f);
    expect(
      betaInfrastructureProposalResponseV1Schema.shape.data.safeParse({
        ...result,
        applicability,
      }).success,
    ).toBe(true);
    expect(
      betaInfrastructureProposalResponseV1Schema.shape.data.safeParse({
        ...result,
        applicability: {
          ...applicability,
          proposalDigest: digestCanonicalValue("other"),
        },
      }).success,
    ).toBe(false);
  });
});
