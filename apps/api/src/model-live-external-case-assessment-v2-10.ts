import {
  modelLiveParserInputReferenceV1Schema,
  modelLiveParserInputReceiptV1Schema,
  type ModelLiveParserInputReceiptV1,
} from "./adapters/persistence/model-live-parser-input-codec.js";
import {
  MODEL_LIVE_IMPORTER_102_SNAPSHOT_DIGESTS,
  createModelLiveRepositoryParserAuthority,
  modelLiveRepositoryParserAuthorityV1Schema,
  requireModelLiveRepositoryImporter,
} from "./model-live-repository-parser-authority.js";
import { z } from "zod";
import {
  assessSolutionProposalPreferencesV2,
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  modelLiveIntentCaseAssessmentV2Schema,
  modelEvaluationMeasurementV1Schema,
  type ModelEvaluationMeasurementV1,
} from "@cloudmarkup/model-gateway";
import { createAwsFrozenModelEvaluationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
import { prepareModelLiveRepositoryInput } from "./model-live-repository-input.js";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";

const caseId = "evaluation_case_external_existing_resource_full_beta_v1";
const dimensions = [
  "structured-schema-validity",
  "capability-requirement-coverage",
  "graph-workload-external-rule-violations",
  "grounded-repository-evidence-rate",
  "stable-id-user-owned-file-preservation",
  "security-policy-violations",
  "issue-clarity-correct-severity",
  "same-ui-semantics-across-assistance-preferences",
] as const;
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const exact = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));
function requireExternal(value: boolean): asserts value {
  if (!value)
    throw Error("The exact external-resource case assessment is unavailable.");
}

/** Importer 1.0.2 successor shape; the issued plan, scoped journal and SQL supply authority. */
export const modelLiveExternalCaseAssessmentV2_10Schema = z
  .object({
    ...modelLiveIntentCaseAssessmentV2Schema.shape,
    recordKind: z.literal("model-live-external-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-external-case-validator.v2"),
    validatorVersion: z.literal("2.10.0"),
    repositoryParser: modelLiveRepositoryParserAuthorityV1Schema,
    repositoryInputReceipt: modelLiveParserInputReferenceV1Schema,
    caseId: z.literal(caseId),
    measurements: z.array(modelEvaluationMeasurementV1Schema).length(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { assessmentDigest, ...body } = value;
    const ds = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const parity = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      value.repositoryParser.snapshotDigest !==
        MODEL_LIVE_IMPORTER_102_SNAPSHOT_DIGESTS[value.caseId] ||
      !exact(
        value.measurements.find(
          (m) => m.dimension === "grounded-repository-evidence-rate",
        )?.evidenceDigests ?? [],
        [
          value.outputDigest,
          value.repositoryParser.snapshotDigest,
          value.repositoryParser.resultDigest,
        ],
      ) ||
      !exact(
        value.measurements.map((m) => m.dimension),
        dimensions,
      ) ||
      !exact(
        value.assistancePreferenceSemantics.map((s) => s.assistancePreference),
        ["guided", "professional"],
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          (m.dimension === "capability-requirement-coverage"
            ? m.denominator !== 4
            : ![
                "graph-workload-external-rule-violations",
                "security-policy-violations",
              ].includes(m.dimension) && m.denominator !== 1) ||
          (m.dimension === "structured-schema-validity" && m.numerator !== 1),
      ) ||
      parity?.numerator !== (ds.length === 1 ? 1 : 0) ||
      !exact(parity.evidenceDigests, ds)
    )
      ctx.addIssue({
        code: "custom",
        message: "External-resource assessment metadata is contradictory.",
      });
  });

/** Real import, command preview, provider validation and both normal review flows.
 * A repository data declaration establishes a reference, never deployed existence,
 * ownership authority, account/Region identity, or permission to create a resource. */
export async function assessModelLiveExternalCaseV2_10(
  options: Parameters<typeof assessSolutionProposalPreferencesV2>[0] & {
    readonly evaluationCase: unknown;
    readonly compiler: PinnedCompilerConfiguration;
    readonly repositoryInput: ModelLiveParserInputReceiptV1;
  },
) {
  requireModelLiveRepositoryImporter("1.0.2");
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseId === caseId,
  );
  const request = options.proposal.input.modelRequest;
  requireExternal(
    evaluationCase !== undefined &&
      same(evaluationCase, options.evaluationCase) &&
      same(
        request,
        createProductionModelLiveCaseRequest({
          caseId,
          requestedMode: request.requestedMode,
        }),
      ) &&
      options.proposal.input.validationEnvironment === "production" &&
      exact(
        evaluationCase.targetDimensions.filter(
          (d) =>
            !["tokens", "credits", "estimated-cost", "latency"].includes(d),
        ),
        dimensions,
      ),
  );
  const imported = await prepareModelLiveRepositoryInput({
    caseKind: "external-existing-resource",
    compiler: options.compiler,
  });
  const evidence = request.planningContext?.approvedRepositoryEvidence;
  requireExternal(
    evidence?.repositorySnapshotDigest ===
      imported.result.snapshot.snapshotDigest &&
      evidence.commitSha === imported.result.snapshot.revision.commitSha,
  );
  const repositoryParser = createModelLiveRepositoryParserAuthority({
    result: imported.result,
    expectedSnapshotDigest: evidence.repositorySnapshotDigest,
    compiler: options.compiler,
  });
  const repositoryInput = modelLiveParserInputReceiptV1Schema.parse(
    options.repositoryInput,
  );
  requireExternal(
    same(repositoryInput.repositoryParser, repositoryParser) &&
      repositoryInput.caseId === evaluationCase.caseId &&
      repositoryInput.caseDigest === evaluationCase.caseDigest &&
      repositoryInput.sourceInputDigest ===
        digestStructuredValue(evaluationCase.input) &&
      repositoryInput.inputDigest ===
        options.proposal.result.descriptor.inputDigest &&
      repositoryInput.invocationId ===
        options.proposal.result.descriptor.invocationId &&
      repositoryInput.descriptorDigest ===
        digestStructuredValue(options.proposal.result.descriptor) &&
      repositoryInput.invocationScopeDigest ===
        digestStructuredValue(options.proposal.result.descriptor.scope) &&
      repositoryInput.requestDigest === digestStructuredValue(request),
  );
  const preferences = await assessSolutionProposalPreferencesV2({
    ...options,
    proposal: {
      ...options.proposal,
      dependencies: {
        ...options.proposal.dependencies,
        validationRules: createAwsFrozenModelEvaluationRulesV1(),
      },
    },
  });
  const assessment = preferences.assessment;
  const candidate = assessment.candidateArchitecture;
  const baseline = request.architecture;
  const response = options.proposal.result.response;
  const resources = candidate.externalResources.resources;
  const resource = resources[0];
  const observed = imported.result.facts.some(
    (f) =>
      f.kind === "resource" &&
      f.external &&
      f.ownership === "external" &&
      f.resourceType === "aws.dynamodb.table",
  );
  const coverage = [
    observed &&
      resources.length === 1 &&
      resource?.resourceType === "aws.dynamodb.table" &&
      resource.provider.state === "known" &&
      resource.provider.providerId === "aws.cloudmarkup",
    resource?.lifecycle.ownershipState === "existing-cloud-managed-elsewhere",
    resource?.addresses.length === 1 &&
      resource.addresses[0]?.kind === "provider-resource-id" &&
      resource.addresses[0].value === "synthetic-existing-notes",
    resource !== undefined &&
      Object.keys(resource.scope).length === 0 &&
      resource.availability.assumption === "unknown" &&
      resource.evidence.length === 0 &&
      resource.architectureNodeIds.length === 0,
  ];
  const preserved =
    same(candidate.nodes, baseline.nodes) &&
    same(candidate.edges, baseline.edges) &&
    same(candidate.workloadBehavior, baseline.workloadBehavior) &&
    same(candidate.applicationContracts, baseline.applicationContracts) &&
    imported.result.snapshot.files.length === 1 &&
    imported.result.snapshot.files[0]?.checksum ===
      imported.source.contentDigest;
  const references = response.proposalContext.confidence.evidenceReferences;
  const grounded = evaluationCase.expected.requiredEvidenceIds.every((id) =>
    references.some((r) => {
      const e = evidence.evidence.find((e) => e.evidenceId === id);
      return (
        e !== undefined &&
        r.kind === "repository-evidence" &&
        r.referenceId === id &&
        r.path === e.path &&
        r.digest === e.fileChecksum &&
        r.location !== undefined &&
        same(r.location, e.location)
      );
    }),
  );
  const findings = assessment.validationReport.findings;
  const issues = assessment.activeIssues.filter(
    (i) => i.lifecycle.state === "current",
  );
  const severity = issues.some(
    (i) => i.severity === "error" || i.severity === "security-error",
  )
    ? "error"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "none";
  const covered = coverage.filter(Boolean).length;
  const clear =
    covered === coverage.length &&
    grounded &&
    preserved &&
    assessment.validationOutcome === "passed" &&
    severity === evaluationCase.expected.expectedIssueSeverity &&
    issues.every(
      (i) =>
        i.summary.trim().length > 0 &&
        i.technicalDetail.trim().length > 0 &&
        i.affected.length > 0,
    ) &&
    preferences.workflows.every((w) => w.state === "review-ready");
  const outputDigest = digestStructuredValue(response),
    reportDigest = digestStructuredValue(assessment.validationReport);
  const inspectionDigest = digestStructuredValue({
    caseDigest: evaluationCase.caseDigest,
    candidate,
    coverage,
    preserved,
    grounded,
    importResultDigest: imported.result.resultDigest,
  });
  const measure = (
    dimension: ModelEvaluationMeasurementV1["dimension"],
    numerator: number,
    denominator: number,
    evidenceDigests: readonly string[],
  ) =>
    modelEvaluationMeasurementV1Schema.parse({
      dimension,
      numerator,
      denominator,
      evidenceDigests,
      sourceAuthority: "deterministic-evaluation-v1",
    });
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-live-external-case-assessment" as const,
    validatorId: "cloudmarkup.live-external-case-validator.v2" as const,
    validatorVersion: "2.10.0" as const,
    repositoryParser,
    repositoryInputReceipt: {
      receiptId: repositoryInput.receiptId,
      receiptDigest: repositoryInput.receiptDigest,
    },
    caseId,
    caseDigest: evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(evaluationCase.input),
    inputDigest: options.proposal.result.descriptor.inputDigest,
    outputDigest,
    proposalDigest: assessment.proposalDigest,
    assistancePreferenceSemantics: preferences.assistancePreferenceSemantics,
    measurements: [
      measure("structured-schema-validity", 1, 1, [outputDigest]),
      measure("capability-requirement-coverage", covered, coverage.length, [
        inspectionDigest,
      ]),
      measure(
        "graph-workload-external-rule-violations",
        findings.filter((f) => ["error", "security-error"].includes(f.severity))
          .length,
        Math.max(1, findings.length),
        [reportDigest],
      ),
      measure("grounded-repository-evidence-rate", grounded ? 1 : 0, 1, [
        outputDigest,
        imported.result.snapshot.snapshotDigest,
        imported.result.resultDigest,
      ]),
      measure("stable-id-user-owned-file-preservation", preserved ? 1 : 0, 1, [
        inspectionDigest,
      ]),
      measure(
        "security-policy-violations",
        findings.filter((f) => f.severity === "security-error").length,
        Math.max(1, findings.length),
        [reportDigest],
      ),
      measure("issue-clarity-correct-severity", clear ? 1 : 0, 1, [
        reportDigest,
        inspectionDigest,
      ]),
      preferences.measurement,
    ],
  };
  return {
    metadata: modelLiveExternalCaseAssessmentV2_10Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    }),
    preferences,
  };
}
