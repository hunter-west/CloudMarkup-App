import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildBedrockConverseRequestV1,
  digestStructuredValue,
  serializedByteLength,
  sha256Text,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import { deterministicFakeResponseV1 } from "@cloudmarkup/model-gateway/testing";
import {
  modelInvocationDescriptorV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  normalizedModelUsageV1Schema,
  type ModelRuntimeHostEvidenceV1,
} from "@cloudmarkup/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ModelRuntimeHostEvidenceError,
  PostgresIntentRuntimeHostEvidence,
} from "./model-runtime-host-evidence.js";
import { parseScope } from "./model-runtime-invocation-codec.js";
import { invocationFixture } from "./model-runtime-invocation-test-helpers.js";
import { platformSpendInvocation } from "./model-platform-spend-test-helpers.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_model_host_evidence_it_" + runId;
const marker = "CloudMarkup synthetic host evidence " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit synthetic loopback PostgreSQL URL required.");
  const parsed = new URL(configuredUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Host evidence tests only accept an explicit loopback database without overrides.",
    );
  return configuredUrl;
}
function expected(record: ModelRuntimeHostEvidenceV1) {
  return {
    evidenceKind: record.evidenceKind,
    catalogDigest: record.catalogDigest,
    inputDigest: record.inputDigest,
    operation: record.operation,
    organizationId: record.organizationId,
    outputBytes: record.outputBytes,
    outputDigest: record.outputDigest,
    outputTokens: record.outputTokens,
    projectId: record.projectId,
    responseSchemaDigest: record.responseSchemaDigest,
    runtimePolicyDigest: record.runtimePolicyDigest,
  };
}

integrationDescribe(
  "deterministic Intent host evidence on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let created = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_model_host_evidence_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe synthetic schema.");
      administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 30000,
      });
      await administration.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
        await tx.query(sql(`COMMENT ON SCHEMA "${schemaName}" IS '${marker}'`));
      });
      created = true;
      database = new PostgresDatabase({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 30000,
        options: `-c search_path=${schemaName} -c timezone=UTC -c statement_timeout=30000`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      expect(
        migrations.find((migration) => migration.version === "0024")
          ?.statements,
      ).toHaveLength(5);
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
    }, 60000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && administration !== undefined) {
          const found = await administration.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schemaName],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_model_host_evidence_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error("Refusing to remove unverified synthetic schema.");
          await administration.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);
    async function fixture(role: "owner" | "editor" | "viewer" = "owner") {
      const scope = parseScope({
        organizationId: id("org"),
        projectId: id("project"),
        userId: id("principal"),
        jobId: id("job"),
      });
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic host evidence')",
            [scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic host evidence',$2)",
            [scope.organizationId, scope.organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
            [scope.organizationId, role, role === "owner"],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,$4)",
            [id("membership"), scope.organizationId, scope.userId, role],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic host evidence',$3)",
            [scope.projectId ?? null, scope.organizationId, scope.userId],
          ),
        );
      });
      const base = platformSpendInvocation(scope);
      if (base.request.operation !== "intent.extract")
        throw new Error("Missing Intent fixture.");
      const request = {
        ...base.request,
        source: {
          ...base.request.source,
          digest: sha256Text(base.request.source.content),
        },
      };
      const invocation: ModelProviderInvocationV1 = {
        ...base,
        request,
        descriptor: modelInvocationDescriptorV1Schema.parse({
          ...base.descriptor,
          providerId: "cloudmarkup.amazon-bedrock",
          modelId: "anthropic.claude-sonnet-5",
          inferenceProfileId: "global.anthropic.claude-sonnet-5",
          inputDigest: digestStructuredValue({ request, scope }),
        }),
      };
      const d = invocation.descriptor;
      const usage = normalizedModelUsageV1Schema.parse({
        ...invocationFixture(scope).result.usage,
        feature: d.feature,
        providerId: d.providerId,
        modelId: d.modelId,
        modelVersion: d.modelVersion,
        inferenceProfileId: d.inferenceProfileId,
        inputDigest: d.inputDigest,
        idempotencyKeyDigest: d.idempotencyKeyDigest,
        promptTemplateId: d.promptTemplateId,
        promptVersion: d.promptVersion,
        invocationId: d.invocationId,
        routing: d.routing,
        thinkingUnits: "3", // Included within the five total output units, never added twice.
      });
      const result = {
        descriptor: d,
        response: deterministicFakeResponseV1(invocation),
        redaction: { categories: [], redactedValueCount: 0 },
        usage,
      };
      const output = {
        invocation,
        result,
        catalogDigest: digestStructuredValue("synthetic catalog"),
        responseSchemaDigest: digestStructuredValue(
          invocation.responseTool.inputSchema,
        ),
        runtimePolicyDigest: digestStructuredValue(
          "synthetic policy, not an activation",
        ),
      };
      return {
        scope,
        invocation,
        output,
        store: new PostgresIntentRuntimeHostEvidence({ database, scope }),
      };
    }
    it("measures the exact adaptive auto tool request for GLOBAL Sonnet 4.6", async () => {
      const f = await fixture();
      const descriptor = modelInvocationDescriptorV1Schema.parse({
        ...f.invocation.descriptor,
        modelId: "anthropic.claude-sonnet-4-6",
        inferenceProfileId: "global.anthropic.claude-sonnet-4-6",
      });
      const invocation = { ...f.invocation, descriptor };
      const record = await f.store.issueInput(invocation);
      if (descriptor.routing === undefined)
        throw new Error("Missing synthetic routing.");
      const route = {
        enabled: true,
        invocationTarget: "global.anthropic.claude-sonnet-4-6",
        modelConfigurationReference:
          descriptor.routing.modelConfigurationReference,
        nativeStructuredOutputSupported: false,
        region: "us-east-1",
        supportedRegions: ["us-east-1"],
        thinkingMode: "adaptive" as const,
        toolChoiceMode: "auto" as const,
        transport: "converse" as const,
      };
      expect(record.requested.promptBytes).toBe(
        serializedByteLength(buildBedrockConverseRequestV1(invocation, route)),
      );
      expect(await f.store.verifyInputEvidence({ evidence: record })).toBe(
        true,
      );
    });

    it("atomically persists one exact input, two output proofs and deterministic replay with no bodies", async () => {
      const f = await fixture();
      const records = await Promise.all(
        Array.from({ length: 6 }, () => f.store.issueInput(f.invocation)),
      );
      const input = records[0];
      if (input === undefined) throw new Error("Missing input evidence.");
      expect(
        records.every(
          (record) => record.evidenceDigest === input.evidenceDigest,
        ),
      ).toBe(true);
      expect(input.requested.promptBytes).toBeGreaterThan(
        serializedByteLength(f.invocation.request),
      );
      expect(input.requested.promptBytes).toBe(
        serializedByteLength(
          buildBedrockConverseRequestV1(f.invocation, {
            enabled: true,
            invocationTarget: "global.anthropic.claude-sonnet-5",
            modelConfigurationReference:
              f.invocation.descriptor.routing?.modelConfigurationReference ??
              "invalid",
            nativeStructuredOutputSupported: false,
            region: "us-east-1",
            supportedRegions: ["us-east-1"],
            thinkingMode: "adaptive",
            transport: "converse",
          }),
        ),
      );
      const first = await f.store.issueOutput(f.output);
      const replay = await f.store.issueOutput(f.output);
      expect(replay).toEqual(first);
      expect(first.outputTokens).toBe(5);
      expect(await f.store.verifyInputEvidence({ evidence: input })).toBe(true);
      for (const evidence of [
        first.allowListedOperationsEvidence,
        first.sourceOwnershipEvidence,
      ])
        expect(
          await f.store.verify({ evidence, expected: expected(evidence) }),
        ).toBe(true);
      const rows = await database.query(
        sql(
          "SELECT evidence_record FROM model_runtime_host_evidence WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rowCount).toBe(3);
      expect(JSON.stringify(rows.rows)).not.toContain(
        "Synthetic spending-fence fixture.",
      );
      expect(JSON.stringify(rows.rows)).not.toContain(
        f.invocation.prompt.content,
      );
      expect(JSON.stringify(rows.rows)).not.toContain("intentDocument");
    });
    it("issues exact Sonnet 4.6 input evidence and rejects model/profile and output-limit substitutions", async () => {
      const f = await fixture();
      const invocation = {
        ...f.invocation,
        maximumOutputTokens: 64000,
        descriptor: modelInvocationDescriptorV1Schema.parse({
          ...f.invocation.descriptor,
          modelId: "anthropic.claude-sonnet-4-6",
          inferenceProfileId: "global.anthropic.claude-sonnet-4-6",
        }),
      };
      const evidence = await f.store.issueInput(invocation);
      expect(evidence.requested.outputTokens).toBe(64000);
      expect(await f.store.verifyInputEvidence({ evidence })).toBe(true);
      await expect(
        f.store.issueInput({ ...invocation, maximumOutputTokens: 64001 }),
      ).rejects.toThrow();
      await expect(
        f.store.issueInput({
          ...invocation,
          descriptor: modelInvocationDescriptorV1Schema.parse({
            ...invocation.descriptor,
            inferenceProfileId: "global.anthropic.claude-sonnet-5",
          }),
        }),
      ).rejects.toThrow();
      await expect(
        f.store.issueInput({
          ...invocation,
          descriptor: modelInvocationDescriptorV1Schema.parse({
            ...invocation.descriptor,
            modelId: "anthropic.claude-opus-4-6-v1",
            inferenceProfileId: "global.anthropic.claude-opus-4-6-v1",
          }),
        }),
      ).rejects.toThrow();
    });

    it("refuses a well-formed self-hashed input record that was never issued", async () => {
      const f = await fixture();
      const input = await f.store.issueInput(f.invocation);
      const { evidenceDigest: previousDigest, ...changed } = {
        ...input,
        evidenceId: "evidence_" + "a".repeat(64),
      };
      const forged = modelRuntimeInputEvidenceV1Schema.parse({
        ...changed,
        evidenceDigest: digestStructuredValue(changed),
      });
      expect(forged.evidenceDigest).not.toBe(previousDigest);
      expect(await f.store.verifyInputEvidence({ evidence: forged })).toBe(
        false,
      );
    });
    it("rejects missing input evidence and substituted output provenance before inserting output proof", async () => {
      const f = await fixture();
      await expect(f.store.issueOutput(f.output)).rejects.toBeInstanceOf(
        ModelRuntimeHostEvidenceError,
      );
      await f.store.issueInput(f.invocation);
      await expect(
        f.store.issueOutput({
          ...f.output,
          result: {
            ...f.output.result,
            descriptor: {
              ...f.output.result.descriptor,
              scope: { ...f.scope, userId: "other-principal" },
            },
          },
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      expect(
        (
          await database.query(
            sql(
              "SELECT evidence_id FROM model_runtime_host_evidence WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("denies cross-tenant verification and exact output expectation substitution", async () => {
      const a = await fixture();
      const b = await fixture();
      const record = await a.store.issueInput(a.invocation);
      const output = await a.store.issueOutput(a.output);
      expect(await b.store.verifyInputEvidence({ evidence: record })).toBe(
        false,
      );
      const evidence = output.allowListedOperationsEvidence;
      expect(
        await b.store.verify({ evidence, expected: expected(evidence) }),
      ).toBe(false);
      expect(
        await a.store.verify({
          evidence,
          expected: {
            ...expected(evidence),
            outputDigest: digestStructuredValue("different"),
          },
        }),
      ).toBe(false);
      expect(
        await a.store.verify({
          evidence,
          expected: {} as ReturnType<typeof expected>,
        }),
      ).toBe(false);
      await expect(
        a.store.issueOutput({
          ...a.output,
          responseSchemaDigest: digestStructuredValue("unvalidated schema"),
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
    });
    it("rechecks revoked membership and keeps previously issued evidence immutable", async () => {
      const f = await fixture("editor");
      const record = await f.store.issueInput(f.invocation);
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      expect(await f.store.verifyInputEvidence({ evidence: record })).toBe(
        false,
      );
      await expect(f.store.issueInput(f.invocation)).rejects.toBeInstanceOf(
        ModelRuntimeHostEvidenceError,
      );
      expect(
        (
          await database.query(
            sql(
              "SELECT evidence_id FROM model_runtime_host_evidence WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("denies a viewer and a project archived after input issuance", async () => {
      const viewer = await fixture("viewer");
      await expect(
        viewer.store.issueInput(viewer.invocation),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      const f = await fixture();
      const record = await f.store.issueInput(f.invocation);
      await database.query(
        sql(
          "UPDATE projects SET lifecycle_status='archived' WHERE organization_id=$1 AND project_id=$2",
          [f.scope.organizationId, f.scope.projectId ?? null],
        ),
      );
      expect(await f.store.verifyInputEvidence({ evidence: record })).toBe(
        false,
      );
    });
    it("rejects a changed complete invocation under an existing evidence identity", async () => {
      const f = await fixture();
      await f.store.issueInput(f.invocation);
      await expect(
        f.store.issueInput({
          ...f.invocation,
          timeoutMilliseconds: f.invocation.timeoutMilliseconds + 1,
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      expect(
        (
          await database.query(
            sql(
              "SELECT evidence_id FROM model_runtime_host_evidence WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("rejects unknown request additions, non-approved routes and secret-bearing input before SQL issuance", async () => {
      const f = await fixture();
      await expect(
        f.store.issueInput({
          ...f.invocation,
          unknown: "unreviewed",
        } as ModelProviderInvocationV1),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      await expect(
        f.store.issueInput({
          ...f.invocation,
          descriptor: {
            ...f.invocation.descriptor,
            modelId: "anthropic.claude-opus-5" as never,
          },
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      const content = "Synthetic api_key=do-not-retain-example";
      if (f.invocation.request.operation !== "intent.extract")
        throw new Error("Missing request.");
      const request = {
        ...f.invocation.request,
        source: {
          ...f.invocation.request.source,
          content,
          digest: sha256Text(content),
        },
      };
      await expect(
        f.store.issueInput({
          ...f.invocation,
          request,
          descriptor: {
            ...f.invocation.descriptor,
            inputDigest: digestStructuredValue({ request, scope: f.scope }),
          },
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeHostEvidenceError);
      expect(
        (
          await database.query(
            sql(
              "SELECT evidence_id FROM model_runtime_host_evidence WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("enforces append-only SQL and rejects unknown metadata keys and unbound output inserts", async () => {
      const f = await fixture();
      const input = await f.store.issueInput(f.invocation);
      const output = await f.store.issueOutput(f.output);
      await expect(
        database.query(
          sql(
            "UPDATE model_runtime_host_evidence SET created_at=created_at WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "DELETE FROM model_runtime_host_evidence WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      const { evidenceDigest: previousInputDigest, ...unknownRecord } = {
        ...input,
        evidenceId: "evidence_" + "b".repeat(64),
        rawPrompt: "Synthetic forbidden text",
      };
      const changed = {
        ...unknownRecord,
        evidenceDigest: digestStructuredValue(unknownRecord),
      };
      expect(changed.evidenceDigest).not.toBe(previousInputDigest);
      await expect(
        database.query(
          sql(
            `INSERT INTO model_runtime_host_evidence SELECT organization_id,project_id,principal_id,$2,'input',$3,invocation_sha256,input_sha256,NULL,$4::jsonb,created_at FROM model_runtime_host_evidence WHERE organization_id=$1 AND evidence_kind='input'`,
            [
              f.scope.organizationId,
              changed.evidenceId,
              changed.evidenceDigest.slice(7),
              JSON.stringify(changed),
            ],
          ),
        ),
      ).rejects.toThrow();
      const evidence = output.allowListedOperationsEvidence;
      const { evidenceDigest: previousOutputDigest, ...unboundOutput } = {
        ...evidence,
        evidenceId: "evidence_" + "c".repeat(64),
      };
      const unbound = {
        ...unboundOutput,
        evidenceDigest: digestStructuredValue(unboundOutput),
      };
      expect(unbound.evidenceDigest).not.toBe(previousOutputDigest);
      await expect(
        database.query(
          sql(
            `INSERT INTO model_runtime_host_evidence SELECT organization_id,project_id,principal_id,$2,evidence_kind,$3,invocation_sha256,input_sha256,$4,$5::jsonb,created_at FROM model_runtime_host_evidence WHERE organization_id=$1 AND evidence_kind='allow-listed-operations'`,
            [
              f.scope.organizationId,
              unbound.evidenceId,
              unbound.evidenceDigest.slice(7),
              evidence.evidenceId,
              JSON.stringify(unbound),
            ],
          ),
        ),
      ).rejects.toThrow();
    });
  },
);
