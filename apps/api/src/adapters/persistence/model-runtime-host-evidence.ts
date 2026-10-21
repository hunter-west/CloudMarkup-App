import {
  buildBedrockConverseRequestV1,
  digestStructuredValue,
  getModelResponseToolV1,
  inspectModelValueForSecretCandidatesV1,
  reviewedModelPromptRegistry,
  serializedByteLength,
  sha256Text,
  validateModelResponseAuthority,
  type ModelGatewayResultV1,
  type ModelProviderInvocationV1,
  type ModelRuntimeHostEvidenceVerifierV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
} from "@cloudmarkup/model-gateway";
import {
  modelIntentExtractionRequestV1Schema,
  modelInvocationDescriptorV1Schema,
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  sha256DigestSchema,
  type ModelRuntimeHostEvidenceV1,
  type ModelRuntimeInputEvidenceV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import {
  bytesOf,
  hex,
  parseResult,
  parseScope,
  same,
  type ModelInvocationScope,
} from "./model-runtime-invocation-codec.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

type Evidence = ModelRuntimeInputEvidenceV1 | ModelRuntimeHostEvidenceV1;
const VERIFIER_ID = "cloudmarkup.intent-host-evidence.v1";
const VERSION = "1.0.0";
const MAXIMUM_METADATA_BYTES = 8192;
const MAXIMUM_CONTENT_BYTES = 16777216;

export class ModelRuntimeHostEvidenceError extends Error {
  readonly code = "model-runtime.host-evidence-unavailable";
  constructor() {
    super("The deterministic AI verification evidence is unavailable.");
    this.name = "ModelRuntimeHostEvidenceError";
  }
}
function requireEvidence(condition: boolean): asserts condition {
  if (!condition) throw new ModelRuntimeHostEvidenceError();
}
function canonicalEvidence(record: Evidence): Evidence {
  const value =
    record.recordKind === "model-runtime-input-evidence"
      ? modelRuntimeInputEvidenceV1Schema.parse(record)
      : modelRuntimeHostEvidenceV1Schema.parse(record);
  requireEvidence(
    bytesOf(value).byteLength <= MAXIMUM_METADATA_BYTES &&
      value.operation === "intent.extract" &&
      value.verifierId === VERIFIER_ID &&
      value.verifierVersion === VERSION,
  );
  return value;
}

/** Append-only deterministic metadata issuer/verifier for the first GLOBAL
 * Sonnet Intent operation. No model call, content object, evaluator promotion,
 * token estimate, customer credit or operational-outcome authority is supplied.
 * The constructor scope MUST come from the authenticated host, never payload.
 * Every transaction also locks/rechecks current active tenant/project/role. */
export class PostgresIntentRuntimeHostEvidence implements ModelRuntimeHostEvidenceVerifierV1 {
  readonly #database: SqlDatabase;
  readonly #scope: ModelInvocationScope;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: ModelInvocationScope;
  }) {
    this.#database = input.database;
    this.#scope = parseScope(input.scope);
    requireEvidence(
      this.#scope.projectId !== undefined && this.#scope.jobId !== undefined,
    );
  }
  async #authorize(tx: SqlExecutor): Promise<void> {
    const found = await tx.query(
      sql(
        `SELECT r.role_key,to_json(r.capabilities)::text AS capabilities FROM memberships m
      JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
      WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r,pr`,
        [
          this.#scope.organizationId,
          this.#scope.projectId ?? null,
          this.#scope.userId,
        ],
      ),
    );
    const role = found.rows[0]?.["role_key"];
    const capabilities = found.rows[0]?.["capabilities"];
    requireEvidence(
      found.rowCount === 1 &&
        typeof role === "string" &&
        isOrganizationRole(role) &&
        typeof capabilities === "string",
    );
    const parsed: unknown = JSON.parse(capabilities);
    requireEvidence(
      Array.isArray(parsed) &&
        parsed.every((value: unknown) => typeof value === "string") &&
        same([...parsed].sort(), [...permissionsForRole(role)].sort()) &&
        permissionsForRole(role).includes("commercial.expensive.use") &&
        permissionsForRole(role).includes("projects.mutate"),
    );
  }
  #parseInvocation(raw: ModelProviderInvocationV1): ModelProviderInvocationV1 {
    const invocation = structuredClone(raw);
    const keys = [
      "descriptor",
      "maximumOutputBytes",
      "maximumOutputTokens",
      "promptCachePolicy",
      "prompt",
      "request",
      "responseTool",
      "timeoutMilliseconds",
    ];
    requireEvidence(
      Object.keys(invocation).length === keys.length &&
        Object.keys(invocation).every((key) => keys.includes(key)),
    );
    const descriptor = modelInvocationDescriptorV1Schema.parse(
      invocation.descriptor,
    );
    const request = modelIntentExtractionRequestV1Schema.parse(
      invocation.request,
    );
    const prompt = reviewedModelPromptRegistry.get("intent.extract");
    requireEvidence(
      prompt !== null &&
        same(invocation.prompt, prompt) &&
        same(
          invocation.responseTool,
          getModelResponseToolV1("intent.extract"),
        ) &&
        same(invocation.promptCachePolicy, {
          cacheKeyRequired: false,
          enabled: false,
          maximumCheckpoints: 0,
          minimumCheckpointTokens: 0,
        }) &&
        same(descriptor.scope, this.#scope) &&
        descriptor.providerFamily === "amazon-bedrock" &&
        descriptor.providerId === "cloudmarkup.amazon-bedrock" &&
        ["anthropic.claude-sonnet-5", "anthropic.claude-sonnet-4-6"].includes(
          descriptor.modelId,
        ) &&
        descriptor.inferenceProfileId === `global.${descriptor.modelId}` &&
        descriptor.feature === "intent.extract" &&
        descriptor.routing?.routeId === "standard-design" &&
        descriptor.routing.modelConfigurationReference.length > 0 &&
        descriptor.promptDigest === prompt.digest &&
        descriptor.promptTemplateId === prompt.templateId &&
        descriptor.promptVersion === prompt.version &&
        descriptor.requestedMode === request.requestedMode &&
        descriptor.inputDigest ===
          digestStructuredValue({ request, scope: this.#scope }) &&
        request.source.digest === sha256Text(request.source.content) &&
        inspectModelValueForSecretCandidatesV1(request).detectedValueCount ===
          0 &&
        Number.isSafeInteger(invocation.maximumOutputBytes) &&
        invocation.maximumOutputBytes > 0 &&
        invocation.maximumOutputBytes <= MAXIMUM_CONTENT_BYTES &&
        Number.isSafeInteger(invocation.maximumOutputTokens) &&
        invocation.maximumOutputTokens > 0 &&
        invocation.maximumOutputTokens <=
          (descriptor.modelId === "anthropic.claude-sonnet-4-6"
            ? 64_000
            : 131072) &&
        Number.isSafeInteger(invocation.timeoutMilliseconds) &&
        invocation.timeoutMilliseconds > 0,
    );
    return { ...invocation, descriptor, request };
  }
  #input(invocation: ModelProviderInvocationV1): ModelRuntimeInputEvidenceV1 {
    const descriptor = invocation.descriptor;
    requireEvidence(
      descriptor.routing !== undefined &&
        descriptor.inferenceProfileId !== undefined,
    );
    const promptBytes = serializedByteLength(
      buildBedrockConverseRequestV1(invocation, {
        ...(descriptor.modelId === "anthropic.claude-sonnet-4-6"
          ? { toolChoiceMode: "auto" as const }
          : {}),
        enabled: true,
        invocationTarget: descriptor.inferenceProfileId,
        modelConfigurationReference:
          descriptor.routing.modelConfigurationReference,
        nativeStructuredOutputSupported: false,
        region: "us-east-1",
        supportedRegions: ["us-east-1"],
        thinkingMode: "adaptive",
        transport: "converse",
      }),
    );
    requireEvidence(promptBytes > 0 && promptBytes <= MAXIMUM_CONTENT_BYTES);
    const record = {
      authority: {
        credential: false,
        deployment: false,
        shell: false,
        tool: false,
        url: false,
      },
      contractVersion: 1,
      inputDigest: descriptor.inputDigest,
      inputSanitized: true,
      noRawSensitiveContent: true,
      operation: "intent.extract",
      organizationId: this.#scope.organizationId,
      projectId: this.#scope.projectId,
      recordKind: "model-runtime-input-evidence",
      requested: {
        dependencyNames: [],
        edgeCount: 0,
        fileCount: 0,
        moduleSources: [],
        nodeCount: 0,
        outputBytes: invocation.maximumOutputBytes,
        outputTokens: invocation.maximumOutputTokens,
        promptBytes,
        providerSources: [],
        repairAttempts: 0,
        repositoryBytes: 0,
        repositoryFiles: 0,
      },
      secretRedactionApplied: true,
      sourceOwnership: { evidenceDigests: [], status: "not-applicable" },
      userId: this.#scope.userId,
      verifierId: VERIFIER_ID,
      verifierVersion: VERSION,
    };
    const identified = {
      ...record,
      evidenceId: `evidence_${hex(digestStructuredValue(record))}`,
    };
    return modelRuntimeInputEvidenceV1Schema.parse({
      ...identified,
      evidenceDigest: digestStructuredValue(identified),
    });
  }
  #values(record: Evidence) {
    requireEvidence(
      record.organizationId === this.#scope.organizationId &&
        record.projectId === this.#scope.projectId &&
        (record.recordKind !== "model-runtime-input-evidence" ||
          record.userId === this.#scope.userId),
    );
    return [
      this.#scope.organizationId,
      this.#scope.projectId ?? null,
      this.#scope.userId,
      record.evidenceId,
    ];
  }
  async #matches(
    tx: SqlExecutor,
    record: Evidence,
    invocationDigest?: Sha256Digest,
  ): Promise<boolean> {
    const rows = await tx.query(
      sql(
        "SELECT evidence_sha256,evidence_record,invocation_sha256 FROM model_runtime_host_evidence WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND evidence_id=$4",
        this.#values(record),
      ),
    );
    const row = rows.rows[0];
    if (rows.rowCount !== 1 || row === undefined) return false;
    const raw = row["evidence_record"];
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (
      row["evidence_sha256"] === hex(record.evidenceDigest) &&
      same(value, record) &&
      (invocationDigest === undefined ||
        row["invocation_sha256"] === hex(invocationDigest))
    );
  }
  async #insert(
    tx: SqlExecutor,
    record: Evidence,
    invocationDigest: Sha256Digest,
    inputId: string | null,
  ): Promise<void> {
    const parsed = canonicalEvidence(record);
    await tx.query(
      sql(
        `INSERT INTO model_runtime_host_evidence(organization_id,project_id,principal_id,evidence_id,evidence_kind,evidence_sha256,invocation_sha256,input_sha256,input_evidence_id,evidence_record)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (organization_id,project_id,principal_id,evidence_id) DO NOTHING`,
        [
          ...this.#values(parsed),
          parsed.recordKind === "model-runtime-input-evidence"
            ? "input"
            : parsed.evidenceKind,
          hex(parsed.evidenceDigest),
          hex(invocationDigest),
          hex(parsed.inputDigest),
          inputId,
          new TextDecoder().decode(bytesOf(parsed)),
        ],
      ),
    );
    requireEvidence(await this.#matches(tx, parsed, invocationDigest));
  }
  async issueInput(
    raw: ModelProviderInvocationV1,
  ): Promise<ModelRuntimeInputEvidenceV1> {
    try {
      const invocation = this.#parseInvocation(raw);
      const record = this.#input(invocation);
      await this.#database.transaction(async (tx) => {
        await this.#authorize(tx);
        await this.#insert(tx, record, digestStructuredValue(invocation), null);
      });
      return record;
    } catch {
      throw new ModelRuntimeHostEvidenceError();
    }
  }
  async issueOutput(input: {
    readonly invocation: ModelProviderInvocationV1;
    readonly result: ModelGatewayResultV1;
    readonly catalogDigest: Sha256Digest;
    readonly responseSchemaDigest: Sha256Digest;
    readonly runtimePolicyDigest: Sha256Digest;
  }): Promise<ModelRuntimeSanitizedOutputEvidenceV1> {
    try {
      const invocation = this.#parseInvocation(input.invocation);
      const issuedInput = this.#input(invocation);
      requireEvidence(
        input.responseSchemaDigest ===
          digestStructuredValue(invocation.responseTool.inputSchema),
      );
      const descriptor = invocation.descriptor;
      const result = parseResult(
        input.result,
        {
          invocationId: descriptor.invocationId,
          authorityDigest: digestStructuredValue(descriptor),
          idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
          inputDigest: descriptor.inputDigest,
        },
        this.#scope,
      );
      requireEvidence(
        same(result.descriptor, descriptor) &&
          result.response.operation === "intent.extract" &&
          inspectModelValueForSecretCandidatesV1(result.response)
            .detectedValueCount === 0,
      );
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(),
        descriptor,
        request: invocation.request,
        response: result.response,
      });
      const outputBytes = serializedByteLength(result.response);
      const outputTokens = Number(result.usage.outputUnits);
      const outputDigest = digestStructuredValue(result.response);
      requireEvidence(
        outputBytes <= invocation.maximumOutputBytes &&
          Number.isSafeInteger(outputTokens) &&
          outputTokens >= 0 &&
          outputTokens <= invocation.maximumOutputTokens,
      );
      const records = (
        ["allow-listed-operations", "source-ownership"] as const
      ).map((evidenceKind) => {
        const record = {
          contractVersion: 1,
          evidenceKind,
          catalogDigest: sha256DigestSchema.parse(input.catalogDigest),
          inputDigest: descriptor.inputDigest,
          operation: "intent.extract",
          organizationId: this.#scope.organizationId,
          projectId: this.#scope.projectId,
          outputBytes,
          outputDigest,
          outputTokens,
          passed: true,
          recordKind: "model-runtime-host-evidence",
          responseSchemaDigest: sha256DigestSchema.parse(
            input.responseSchemaDigest,
          ),
          runtimePolicyDigest: sha256DigestSchema.parse(
            input.runtimePolicyDigest,
          ),
          verifierId: VERIFIER_ID,
          verifierVersion: VERSION,
        };
        const identified = {
          ...record,
          evidenceId: `evidence_${hex(digestStructuredValue({ record, userId: this.#scope.userId }))}`,
        };
        return modelRuntimeHostEvidenceV1Schema.parse({
          ...identified,
          evidenceDigest: digestStructuredValue(identified),
        });
      });
      await this.#database.transaction(async (tx) => {
        await this.#authorize(tx);
        requireEvidence(
          await this.#matches(
            tx,
            issuedInput,
            digestStructuredValue(invocation),
          ),
        );
        for (const record of records)
          await this.#insert(
            tx,
            record,
            digestStructuredValue(invocation),
            issuedInput.evidenceId,
          );
      });
      const [allowListedOperationsEvidence, sourceOwnershipEvidence] = records;
      requireEvidence(
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
    } catch {
      throw new ModelRuntimeHostEvidenceError();
    }
  }
  async verifyInputEvidence(
    input: Parameters<
      ModelRuntimeHostEvidenceVerifierV1["verifyInputEvidence"]
    >[0],
  ): Promise<boolean> {
    try {
      const record = canonicalEvidence(
        modelRuntimeInputEvidenceV1Schema.parse(input.evidence),
      );
      return await this.#database.transaction(async (tx) => {
        await this.#authorize(tx);
        return this.#matches(tx, record);
      });
    } catch {
      return false;
    }
  }
  async verify(
    input: Parameters<ModelRuntimeHostEvidenceVerifierV1["verify"]>[0],
  ): Promise<boolean> {
    try {
      const record = canonicalEvidence(
        modelRuntimeHostEvidenceV1Schema.parse(input.evidence),
      );
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
      ];
      requireEvidence(
        same(Object.keys(input.expected).sort(), expectedKeys.sort()),
      );
      requireEvidence(
        Object.entries(input.expected).every(
          ([key, value]) => Reflect.get(record, key) === value,
        ),
      );
      return await this.#database.transaction(async (tx) => {
        await this.#authorize(tx);
        return this.#matches(tx, record);
      });
    } catch {
      return false;
    }
  }
  verifyOperationalOutcome(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
