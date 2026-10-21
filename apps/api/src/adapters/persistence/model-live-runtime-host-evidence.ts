import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  serializedByteLength,
  validateModelLiveEvaluationRequestV2,
  validateModelResponseAuthority,
  type ModelGatewayResultV1,
  type ModelProviderInvocationV1,
  type ModelRuntimeHostEvidenceVerifierV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
} from "@cloudmarkup/model-gateway";
import {
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveEvaluationPlanV2,
  type ModelRuntimeHostEvidenceV1,
  type ModelRuntimeInputEvidenceV1,
} from "@cloudmarkup/schemas";
import {
  bytesOf,
  parseScope,
  same,
  type ModelInvocationScope,
} from "./model-runtime-invocation-codec.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import type { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import {
  MODEL_LIVE_HOST_EVIDENCE_MAXIMUM_BYTES,
  MODEL_LIVE_HOST_EVIDENCE_VERIFIER,
  MODEL_LIVE_HOST_EVIDENCE_VERSION,
  ModelLiveRuntimeHostEvidenceError,
  modelLiveBedrockHostConfigurationV2Schema,
  type ModelLiveBedrockHostConfigurationV2,
  prepareModelLiveRuntimeInputV2,
  requireLiveHostEvidence,
  type PreparedModelLiveRuntimeInputV2,
} from "./model-live-runtime-host-evidence-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

type Evidence = ModelRuntimeInputEvidenceV1 | ModelRuntimeHostEvidenceV1;
const read = (value: unknown): unknown =>
  typeof value === "string" ? (JSON.parse(value) as unknown) : value;
const hex = (value: string) => sha256DigestSchema.parse(value).slice(7);

/** Append-only live input and deterministic output safety/ownership metadata.
 * Constructor scope/configuration and the journal MUST be supplied by the
 * authenticated host. No provider call, validator score, financial settlement,
 * normal promotion or operational-outcome authority is exposed. Full invocation
 * and result bodies are used in RAM only. Original V1 storage is untouched. */
export class PostgresModelLiveRuntimeHostEvidence implements ModelRuntimeHostEvidenceVerifierV1 {
  readonly #plans: PostgresModelLiveEvaluationPlans;
  readonly #scope: ModelInvocationScope;
  readonly #configuration: ModelLiveBedrockHostConfigurationV2;
  readonly #reference: {
    readonly definitionId: string;
    readonly planDigest: string;
  };
  readonly #caseId: string;
  constructor(input: {
    readonly plans: PostgresModelLiveEvaluationPlans;
    readonly scope: ModelInvocationScope;
    readonly configuration: ModelLiveBedrockHostConfigurationV2;
    readonly definitionId: string;
    readonly planDigest: string;
    readonly caseId: string;
  }) {
    this.#plans = input.plans;
    this.#scope = parseScope(input.scope);
    this.#configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      input.configuration,
    );
    this.#reference = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    this.#caseId = solutionStableIdSchema.parse(input.caseId);
    requireLiveHostEvidence(
      this.#scope.projectId !== undefined && this.#scope.jobId !== undefined,
    );
  }
  #keys() {
    return [
      this.#scope.organizationId,
      this.#scope.projectId ?? null,
      this.#scope.userId,
      hex(this.#reference.planDigest),
      this.#caseId,
    ];
  }
  #bindPlan(plan: ModelLiveEvaluationPlanV2) {
    requireLiveHostEvidence(
      plan.planDigest === this.#reference.planDigest &&
        plan.definition.definitionId === this.#reference.definitionId &&
        plan.definition.scope.organizationId === this.#scope.organizationId &&
        plan.definition.scope.projectId === this.#scope.projectId &&
        plan.definition.scope.userId === this.#scope.userId,
    );
    const binding = plan.definition.cases.find(
      (entry) => entry.caseId === this.#caseId,
    );
    requireLiveHostEvidence(binding !== undefined);
    return binding;
  }
  #canonical(raw: Evidence, plan: ModelLiveEvaluationPlanV2): Evidence {
    const record =
      raw.recordKind === "model-runtime-input-evidence"
        ? modelRuntimeInputEvidenceV1Schema.parse(raw)
        : modelRuntimeHostEvidenceV1Schema.parse(raw);
    const binding = this.#bindPlan(plan);
    requireLiveHostEvidence(
      record.verifierId === MODEL_LIVE_HOST_EVIDENCE_VERIFIER &&
        record.verifierVersion === MODEL_LIVE_HOST_EVIDENCE_VERSION &&
        record.organizationId === this.#scope.organizationId &&
        record.projectId === this.#scope.projectId &&
        record.inputDigest === binding.invocationInputDigest &&
        record.operation ===
          binding.authorityBinding.authorityTuple.operation &&
        (record.recordKind !== "model-runtime-input-evidence" ||
          record.userId === this.#scope.userId) &&
        (record.recordKind !== "model-runtime-host-evidence" ||
          (record.catalogDigest ===
            binding.authorityBinding.authorityTuple.catalogDigest &&
            record.responseSchemaDigest ===
              binding.authorityBinding.authorityTuple.responseSchemaDigest &&
            record.runtimePolicyDigest ===
              plan.definition.policy.policyDigest)) &&
        bytesOf(record).byteLength <= MODEL_LIVE_HOST_EVIDENCE_MAXIMUM_BYTES &&
        inspectModelValueForSecretCandidatesV1(record).detectedValueCount === 0,
    );
    return record;
  }
  async #prepare(
    tx: SqlExecutor,
    plan: ModelLiveEvaluationPlanV2,
    invocation: ModelProviderInvocationV1,
  ) {
    this.#bindPlan(plan);
    const time = await tx.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
      ),
    );
    return prepareModelLiveRuntimeInputV2({
      caseId: this.#caseId,
      configuration: this.#configuration,
      invocation,
      observedAt: utcTimestampSchema.parse(time.rows[0]?.["now"]),
      plan,
      scope: this.#scope,
    });
  }
  async #matches(
    tx: SqlExecutor,
    raw: Evidence,
    plan: ModelLiveEvaluationPlanV2,
    prepared?: PreparedModelLiveRuntimeInputV2,
  ) {
    const record = this.#canonical(raw, plan);
    const found = await tx.query(
      sql(
        "SELECT * FROM model_live_runtime_host_evidence WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 AND case_id=$5 AND evidence_id=$6",
        [...this.#keys(), record.evidenceId],
      ),
    );
    const row = found.rows[0];
    if (found.rowCount !== 1 || row === undefined) return false;
    const binding = this.#bindPlan(plan);
    return (
      row["evidence_sha256"] === hex(record.evidenceDigest) &&
      row["invocation_scope_sha256"] ===
        hex(digestStructuredValue(this.#scope)) &&
      row["case_sha256"] === hex(binding.caseDigest) &&
      row["input_sha256"] === hex(record.inputDigest) &&
      same(
        this.#canonical(read(row["evidence_record"]) as Evidence, plan),
        record,
      ) &&
      (prepared === undefined ||
        (row["invocation_id"] === prepared.invocation.descriptor.invocationId &&
          row["invocation_sha256"] === hex(prepared.invocationDigest) &&
          row["descriptor_sha256"] ===
            hex(digestStructuredValue(prepared.invocation.descriptor)) &&
          row["route_sha256"] === hex(prepared.routeDigest) &&
          row["input_evidence_id"] ===
            (record.recordKind === "model-runtime-input-evidence"
              ? null
              : prepared.inputEvidence.evidenceId)))
    );
  }
  async #insert(
    tx: SqlExecutor,
    raw: Evidence,
    prepared: PreparedModelLiveRuntimeInputV2,
  ) {
    const record = this.#canonical(raw, prepared.plan);
    const binding = this.#bindPlan(prepared.plan);
    const isInput = record.recordKind === "model-runtime-input-evidence";
    await tx.query(
      sql(
        "INSERT INTO model_live_runtime_host_evidence (organization_id,project_id,principal_id,plan_sha256,case_id,evidence_id,case_sha256,evidence_kind,evidence_sha256,invocation_id,invocation_sha256,descriptor_sha256,route_sha256,input_sha256,input_evidence_id,journal_invocation_id,invocation_scope_sha256,evidence_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb) ON CONFLICT (organization_id,project_id,principal_id,evidence_id) DO NOTHING",
        [
          ...this.#keys(),
          record.evidenceId,
          hex(binding.caseDigest),
          isInput ? "input" : record.evidenceKind,
          hex(record.evidenceDigest),
          prepared.invocation.descriptor.invocationId,
          hex(prepared.invocationDigest),
          hex(digestStructuredValue(prepared.invocation.descriptor)),
          hex(prepared.routeDigest),
          hex(record.inputDigest),
          isInput ? null : prepared.inputEvidence.evidenceId,
          isInput ? null : prepared.invocation.descriptor.invocationId,
          hex(digestStructuredValue(this.#scope)),
          new TextDecoder().decode(bytesOf(record)),
        ],
      ),
    );
    requireLiveHostEvidence(
      await this.#matches(tx, record, prepared.plan, prepared),
    );
  }
  async issueInput(
    raw: ModelProviderInvocationV1,
  ): Promise<ModelRuntimeInputEvidenceV1> {
    try {
      const invocation = structuredClone(raw);
      return await this.#plans.withIssuedMetadata(
        this.#reference,
        async ({ transaction, plan, requireCurrentApproval }) => {
          await requireCurrentApproval();
          const prepared = await this.#prepare(transaction, plan, invocation);
          await this.#insert(transaction, prepared.inputEvidence, prepared);
          return prepared.inputEvidence;
        },
      );
    } catch {
      throw new ModelLiveRuntimeHostEvidenceError();
    }
  }
  async issueOutput(input: {
    readonly invocation: ModelProviderInvocationV1;
    readonly result: ModelGatewayResultV1;
    readonly journal: PostgresModelLiveInvocationJournal;
  }): Promise<ModelRuntimeSanitizedOutputEvidenceV1> {
    try {
      requireLiveHostEvidence(
        same(Object.keys(input).sort(), ["invocation", "journal", "result"]),
      );
      const invocation = structuredClone(input.invocation);
      return await input.journal.withCompletedOutputMetadata(
        input.result,
        async (context) => {
          const { plan, transaction, result, binding, admission } = context;
          this.#bindPlan(plan);
          requireLiveHostEvidence(
            same(binding.scope, this.#scope) &&
              binding.evaluationCaseId === this.#caseId &&
              binding.liveEvaluationPlanDigest === this.#reference.planDigest,
          );
          const prepared = await this.#prepare(transaction, plan, invocation);
          requireLiveHostEvidence(
            same(result.descriptor, prepared.invocation.descriptor) &&
              (await this.#matches(
                transaction,
                prepared.inputEvidence,
                plan,
                prepared,
              )),
          );
          // This comparison authenticates no request by itself; the journal bridge
          // already owns the actual issued/current plan and admitted workflow.
          validateModelLiveEvaluationRequestV2({
            plan,
            request: admission,
            inputEvidence: prepared.inputEvidence,
            observedAt: prepared.observedAt,
          });
          requireLiveHostEvidence(
            result.descriptor.routing?.routingDecisionDigest ===
              admission.routingDecisionDigest &&
              inspectModelValueForSecretCandidatesV1(result.response)
                .detectedValueCount === 0,
          );
          validateModelResponseAuthority({
            allowedApprovalPathIds: new Set(
              "boundary" in invocation.request
                ? invocation.request.boundary.approvalPathIds
                : [],
            ),
            descriptor: result.descriptor,
            request: invocation.request,
            response: result.response,
          });
          if ("candidateBundle" in result.response) {
            requireLiveHostEvidence(
              result.response.candidateBundle.candidates.length <=
                plan.definition.policy.limits.maximumFiles,
            );
            for (const dependency of result.response.candidateBundle
              .dependencies) {
              const allowed =
                dependency.kind === "package"
                  ? plan.definition.policy.allowlists.dependencies
                  : dependency.kind === "module"
                    ? plan.definition.policy.allowlists.modules
                    : plan.definition.policy.allowlists.providers;
              requireLiveHostEvidence(
                new Set<string>(allowed).has(dependency.name),
              );
            }
          }
          const outputBytes = serializedByteLength(result.response);
          const outputTokens = Number(result.usage.outputUnits);
          const outputDigest = digestStructuredValue(result.response);
          requireLiveHostEvidence(
            outputBytes > 0 &&
              outputBytes <= invocation.maximumOutputBytes &&
              Number.isSafeInteger(outputTokens) &&
              outputTokens >= 0 &&
              outputTokens <= invocation.maximumOutputTokens,
          );
          const tuple = this.#bindPlan(plan).authorityBinding.authorityTuple;
          const records = (
            ["allow-listed-operations", "source-ownership"] as const
          ).map((evidenceKind) => {
            const record = {
              contractVersion: 1,
              evidenceKind,
              catalogDigest: tuple.catalogDigest,
              inputDigest: invocation.descriptor.inputDigest,
              operation: invocation.request.operation,
              organizationId: this.#scope.organizationId,
              projectId: this.#scope.projectId,
              outputBytes,
              outputDigest,
              outputTokens,
              passed: true,
              recordKind: "model-runtime-host-evidence",
              responseSchemaDigest: tuple.responseSchemaDigest,
              runtimePolicyDigest: plan.definition.policy.policyDigest,
              verifierId: MODEL_LIVE_HOST_EVIDENCE_VERIFIER,
              verifierVersion: MODEL_LIVE_HOST_EVIDENCE_VERSION,
            };
            const identified = {
              ...record,
              evidenceId:
                "evidence_" +
                digestStructuredValue({
                  record,
                  inputEvidenceId: prepared.inputEvidence.evidenceId,
                  planDigest: plan.planDigest,
                  caseId: this.#caseId,
                  invocationDigest: prepared.invocationDigest,
                  routeDigest: prepared.routeDigest,
                }).slice(7),
            };
            return modelRuntimeHostEvidenceV1Schema.parse({
              ...identified,
              evidenceDigest: digestStructuredValue(identified),
            });
          });
          for (const record of records)
            await this.#insert(transaction, record, prepared);
          const [allowListedOperationsEvidence, sourceOwnershipEvidence] =
            records;
          requireLiveHostEvidence(
            allowListedOperationsEvidence !== undefined &&
              sourceOwnershipEvidence !== undefined,
          );
          return {
            allowListedOperationsEvidence,
            sourceOwnershipEvidence,
            noRawSensitiveContent: true,
            outputBytes,
            outputDigest,
            outputTokens,
            resultSanitized: true,
            secretRedactionApplied: true,
            structuredOutputValidated: true,
          };
        },
      );
    } catch {
      throw new ModelLiveRuntimeHostEvidenceError();
    }
  }
  async verifyInputEvidence(
    input: Parameters<
      ModelRuntimeHostEvidenceVerifierV1["verifyInputEvidence"]
    >[0],
  ) {
    try {
      const record = modelRuntimeInputEvidenceV1Schema.parse(input.evidence);
      return await this.#plans.withIssuedMetadata(
        this.#reference,
        ({ transaction, plan }) => this.#matches(transaction, record, plan),
      );
    } catch {
      return false;
    }
  }
  async verify(
    input: Parameters<ModelRuntimeHostEvidenceVerifierV1["verify"]>[0],
  ) {
    try {
      const record = modelRuntimeHostEvidenceV1Schema.parse(input.evidence);
      const expectedKeys = [
        "evidenceKind",
        "catalogDigest",
        "inputDigest",
        "operation",
        "organizationId",
        "outputBytes",
        "outputDigest",
        "outputTokens",
        "projectId",
        "responseSchemaDigest",
        "runtimePolicyDigest",
      ].sort();
      requireLiveHostEvidence(
        same(Object.keys(input.expected).sort(), expectedKeys) &&
          Object.entries(input.expected).every(
            ([key, value]) => Reflect.get(record, key) === value,
          ),
      );
      return await this.#plans.withIssuedMetadata(
        this.#reference,
        ({ transaction, plan }) => this.#matches(transaction, record, plan),
      );
    } catch {
      return false;
    }
  }
  verifyOperationalOutcome(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
