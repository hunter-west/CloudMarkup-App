import { describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { syntheticRepositoryCase } from "../../model-live-repository-test-helpers.js";
import {
  modelLiveRepositoryCaseAssessmentV2Schema,
  assessModelLiveRepositoryCaseV2,
} from "../../model-live-repository-case-assessment.js";
import { modelLiveRepositoryCaseAssessmentV2_9Schema } from "../../model-live-repository-case-assessment-v2-9.js";
import {
  identifyModelLiveParserInputReceipt,
  modelLiveParserInputReceiptV1Schema,
} from "./model-live-parser-input-codec.js";
import { identifyLiveProposalValidationReceipt } from "./model-live-proposal-validation-codec.js";
import { requireModelLiveParserValidationBinding } from "./model-live-parser-validation.js";
import { WorkflowStatementDatabase } from "./model-commercial-workflow-test-helpers.js";

/** Shape/read fixtures only. No fake object here is represented as an actual
 * parser execution, durable issuance, provider usage or settlement. */
function fixture() {
  const sample = syntheticRepositoryCase("ambiguous-source-code-inference");
  const digest = digestStructuredValue("synthetic metadata");
  const projectId = sample.descriptor.scope.projectId;
  if (!projectId) throw Error("Missing synthetic project");
  const parser = identifyModelLiveParserInputReceipt({
    contractVersion: 1,
    recordKind: "model-live-parser-input-receipt",
    organizationId: sample.descriptor.scope.organizationId,
    projectId,
    userId: sample.descriptor.scope.userId,
    invocationId: sample.descriptor.invocationId,
    invocationScopeDigest: digestStructuredValue(sample.descriptor.scope),
    invocationDigest: digest,
    descriptorDigest: digestStructuredValue(sample.descriptor),
    requestDigest: digestStructuredValue(sample.request),
    runtimeRequestDigest: digest,
    planDigest: digest,
    approvalDigest: digest,
    caseId: sample.evaluationCase.caseId,
    caseDigest: sample.evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(sample.evaluationCase.input),
    inputDigest: sample.descriptor.inputDigest,
    inputEvidenceId: "evidence_" + digest.slice(7),
    inputEvidenceDigest: digest,
    repositoryParser: {
      importerId: "cloudmarkup.repository-importer",
      importerVersion: "1.0.2",
      snapshotDigest: sample.request.repositorySnapshotDigest,
      resultDigest: digest,
      compilerExecutableDigest: digest,
    },
  });
  const dimensions = [
    "structured-schema-validity",
    "security-policy-violations",
    "grounded-repository-evidence-rate",
    "stable-id-user-owned-file-preservation",
    "issue-clarity-correct-severity",
    "same-ui-semantics-across-assistance-preferences",
    "unresolved-behavior-honesty",
  ] as const;
  const body = {
    contractVersion: 2,
    recordKind: "model-live-repository-case-assessment",
    validatorId: "cloudmarkup.live-repository-case-validator.v2",
    validatorVersion: "2.9.0",
    caseId: parser.caseId,
    caseDigest: parser.caseDigest,
    sourceInputDigest: parser.sourceInputDigest,
    inputDigest: parser.inputDigest,
    outputDigest: sample.outputDigest,
    proposalDigest: digest,
    repositoryParser: parser.repositoryParser,
    repositoryInputReceipt: {
      receiptId: parser.receiptId,
      receiptDigest: parser.receiptDigest,
    },
    measurements: dimensions.map((dimension) => ({
      dimension,
      numerator: dimension === "issue-clarity-correct-severity" ? 0 : 1,
      denominator: 1,
      sourceAuthority: "deterministic-evaluation-v1",
      evidenceDigests:
        dimension === "grounded-repository-evidence-rate"
          ? [
              sample.outputDigest,
              parser.repositoryParser.snapshotDigest,
              parser.repositoryParser.resultDigest,
            ]
          : [digest],
    })),
    assistancePreferenceSemantics: [
      { assistancePreference: "guided", semanticDigest: digest },
      { assistancePreference: "professional", semanticDigest: digest },
    ],
  };
  const assessment = modelLiveRepositoryCaseAssessmentV2_9Schema.parse({
    ...body,
    assessmentDigest: digestStructuredValue(body),
  });
  const receipt = identifyLiveProposalValidationReceipt({
    contractVersion: 2,
    recordKind: "model-live-proposal-validation-receipt",
    organizationId: parser.organizationId,
    projectId: parser.projectId,
    userId: parser.userId,
    invocationId: parser.invocationId,
    journalBindingDigest: digest,
    runtimeRequestDigest: parser.runtimeRequestDigest,
    planDigest: parser.planDigest,
    approvalDigest: parser.approvalDigest,
    inputEvidenceId: parser.inputEvidenceId,
    inputEvidenceDigest: parser.inputEvidenceDigest,
    operationsEvidenceId: "evidence_" + digest.slice(7),
    operationsEvidenceDigest: digest,
    ownershipEvidenceId: "evidence_" + digest.slice(7),
    ownershipEvidenceDigest: digest,
    normalizedUsageDigest: digest,
    assessment,
  });
  const database = new WorkflowStatementDatabase();
  database.rows.set(
    [
      parser.organizationId,
      parser.projectId,
      parser.userId,
      parser.invocationId,
    ].join("|"),
    {
      organization_id: parser.organizationId,
      project_id: parser.projectId,
      principal_id: parser.userId,
      invocation_id: parser.invocationId,
      receipt_record: parser,
      receipt_id: parser.receiptId,
      receipt_sha256: parser.receiptDigest.slice(7),
      plan_sha256: parser.planDigest.slice(7),
      case_id: parser.caseId,
      input_evidence_id: parser.inputEvidenceId,
    },
  );
  const binding = {
    transaction: database,
    receipt,
    invocationScopeDigest: parser.invocationScopeDigest,
    invocationDigest: parser.invocationDigest,
    descriptorDigest: parser.descriptorDigest,
  };
  return { sample, parser, receipt, database, binding };
}
function reidentify(
  receipt: ReturnType<typeof fixture>["receipt"],
  changes: Partial<
    Omit<ReturnType<typeof fixture>["receipt"], "receiptId" | "receiptDigest">
  >,
) {
  const { receiptId, receiptDigest, ...body } = receipt;
  void receiptId;
  void receiptDigest;
  return identifyLiveProposalValidationReceipt({ ...body, ...changes });
}
function legacy(receipt: ReturnType<typeof fixture>["receipt"]) {
  const body = Object.fromEntries(
    Object.entries(receipt.assessment).filter(
      ([key]) =>
        ![
          "assessmentDigest",
          "repositoryParser",
          "repositoryInputReceipt",
        ].includes(key),
    ),
  );
  body["validatorVersion"] = "2.6.0";
  const assessment = modelLiveRepositoryCaseAssessmentV2Schema.parse({
    ...body,
    assessmentDigest: digestStructuredValue(body),
  });
  return reidentify(receipt, { assessment });
}

describe("parser input metadata and exact historical read binding", () => {
  it("keeps negative quality and reads the exact matching issued row without writes", async () => {
    const f = fixture();
    await expect(
      requireModelLiveParserValidationBinding(f.binding),
    ).resolves.toBeUndefined();
    expect(
      f.receipt.assessment.measurements.find(
        (m) => m.dimension === "issue-clarity-correct-severity",
      )?.numerator,
    ).toBe(0);
    expect(
      f.database.statements.every((statement) =>
        statement.text.startsWith("SELECT "),
      ),
    ).toBe(true);
  });
  it("retains old metadata reads only when no new parser binding exists", async () => {
    const f = fixture();
    const old = legacy(f.receipt);
    await expect(
      requireModelLiveParserValidationBinding({ ...f.binding, receipt: old }),
    ).rejects.toThrow();
    f.database.rows.clear();
    await expect(
      requireModelLiveParserValidationBinding({ ...f.binding, receipt: old }),
    ).resolves.toBeUndefined();
    await expect(
      requireModelLiveParserValidationBinding(f.binding),
    ).rejects.toThrow();
    expect(
      f.database.statements.every((statement) =>
        statement.text.startsWith("SELECT "),
      ),
    ).toBe(true);
  });
  it.each([
    "planDigest",
    "approvalDigest",
    "runtimeRequestDigest",
    "inputEvidenceDigest",
  ] as const)("rejects rehashed validation %s substitutions", async (field) => {
    const f = fixture();
    const receipt = reidentify(f.receipt, {
      [field]: digestStructuredValue("changed binding"),
    });
    await expect(
      requireModelLiveParserValidationBinding({ ...f.binding, receipt }),
    ).rejects.toThrow();
  });
  it.each([
    "invocationScopeDigest",
    "invocationDigest",
    "descriptorDigest",
  ] as const)("rejects changed %s at terminal read", async (field) => {
    const f = fixture();
    await expect(
      requireModelLiveParserValidationBinding({
        ...f.binding,
        [field]: digestStructuredValue("changed binding"),
      }),
    ).rejects.toThrow();
  });
  it.each([
    "sourceInputDigest",
    "caseDigest",
    "repositoryInputReceipt",
  ] as const)("rejects rehashed assessment %s substitutions", async (field) => {
    const f = fixture();
    const changed =
      field === "repositoryInputReceipt"
        ? {
            receiptId: "parser_input_" + "1".repeat(64),
            receiptDigest: digestStructuredValue("other receipt"),
          }
        : digestStructuredValue("changed binding");
    const body = Object.fromEntries(
      Object.entries(f.receipt.assessment).filter(
        ([key]) => key !== "assessmentDigest",
      ),
    );
    body[field] = changed;
    const assessment = modelLiveRepositoryCaseAssessmentV2_9Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    });
    const receipt = reidentify(f.receipt, { assessment });
    await expect(
      requireModelLiveParserValidationBinding({ ...f.binding, receipt }),
    ).rejects.toThrow();
  });
  it("rejects forged metadata, unknown parser versions, and raw content fields", () => {
    const { parser } = fixture();
    const changedSnapshotBody = {
      ...Object.fromEntries(
        Object.entries(parser).filter(
          ([key]) => !["receiptId", "receiptDigest"].includes(key),
        ),
      ),
      repositoryParser: {
        ...parser.repositoryParser,
        snapshotDigest: digestStructuredValue("different source"),
      },
    };
    const identifiedSnapshot = {
      ...changedSnapshotBody,
      receiptId:
        "parser_input_" + digestStructuredValue(changedSnapshotBody).slice(7),
    };
    const changedSnapshot = {
      ...identifiedSnapshot,
      receiptDigest: digestStructuredValue(identifiedSnapshot),
    };
    for (const value of [
      { ...parser, receiptDigest: digestStructuredValue("changed") },
      {
        ...parser,
        repositoryParser: {
          ...parser.repositoryParser,
          importerVersion: "1.0.1",
        },
      },
      changedSnapshot,
      { ...parser, source: "https://untrusted.example/private-source" },
    ])
      expect(modelLiveParserInputReceiptV1Schema.safeParse(value).success).toBe(
        false,
      );
  });
  it("refuses old validator execution before opening a compiler or parsing source", async () => {
    const { sample } = fixture();
    await expect(
      assessModelLiveRepositoryCaseV2({
        ...sample,
        compiler: {
          executablePath: "not-an-executable",
          executableSha256: "0".repeat(64),
        },
      }),
    ).rejects.toThrow("exact repository parser version");
  });
});
