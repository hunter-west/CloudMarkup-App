/* eslint-disable @typescript-eslint/require-await -- Scripted statement/object ports are not PostgreSQL emulation. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { describe, expect, it } from "vitest";
import {
  bytesOf,
  decodeJson,
  ModelRuntimePersistenceError,
  parseClaim,
  parseResult,
  validEscalation,
} from "./model-runtime-invocation-codec.js";
import {
  PostgresModelInvocationStore,
  type ModelRuntimeResultObjectPort,
} from "./model-runtime-invocation-store.js";
import {
  escalationFixture,
  invocationFixture,
  syntheticScope,
} from "./model-runtime-invocation-test-helpers.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class ScriptedDatabase implements SqlDatabase {
  statements: SqlStatement[] = [];
  async close(): Promise<void> {
    return;
  }
  async transaction<T>(
    work: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }
  async query<T extends SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    this.statements.push(statement);
    return { rowCount: statement.text.startsWith("INSERT") ? 1 : 0, rows: [] };
  }
}
const unavailableObjects: ModelRuntimeResultObjectPort = {
  async put() {
    throw new Error("Object writes are not expected in this statement test.");
  },
  async get() {
    throw new Error("Object reads are not expected in this statement test.");
  },
};

describe("durable model invocation codec and query boundary", () => {
  it("round-trips an exact typed result and full trusted scope", () => {
    const { claim, result } = invocationFixture();
    expect(
      parseResult(decodeJson(bytesOf(result)), claim, syntheticScope),
    ).toEqual(result);
  });
  it.each(["organizationId", "projectId", "userId", "jobId"] as const)(
    "rejects a substituted %s before object or SQL writes",
    async (field) => {
      const { claim, result } = invocationFixture();
      const database = new ScriptedDatabase();
      const store = new PostgresModelInvocationStore({
        database,
        objects: unavailableObjects,
        scope: { ...syntheticScope, [field]: "other-owner" },
      });
      await expect(store.complete(claim, result)).rejects.toThrow(
        ModelRuntimePersistenceError,
      );
      expect(database.statements).toEqual([]);
    },
  );
  it.each([
    "modelId",
    "providerId",
    "promptDigest",
    "inputDigest",
    "invocationId",
  ] as const)("rejects substituted result provenance %s", (field) => {
    const { claim, result } = invocationFixture();
    const value = field.endsWith("Digest")
      ? digestStructuredValue("substituted")
      : "substituted.identity";
    expect(() =>
      parseResult(
        {
          ...result,
          response: {
            ...result.response,
            provenance: { ...result.response.provenance, [field]: value },
          },
        },
        claim,
        syntheticScope,
      ),
    ).toThrow(ModelRuntimePersistenceError);
  });
  it("rejects malformed JSON, invalid UTF-8, unknown claim fields, and changed usage identity", () => {
    const { claim, result } = invocationFixture();
    expect(() => decodeJson(new Uint8Array([255]))).toThrow(
      ModelRuntimePersistenceError,
    );
    expect(() => decodeJson(new TextEncoder().encode("not-json"))).toThrow(
      ModelRuntimePersistenceError,
    );
    expect(() =>
      parseClaim({ ...claim, prompt: "must not persist raw content" }),
    ).toThrow(ModelRuntimePersistenceError);
    expect(() =>
      parseResult(
        {
          ...result,
          usage: { ...result.usage, invocationId: "another-invocation" },
        },
        claim,
        syntheticScope,
      ),
    ).toThrow(ModelRuntimePersistenceError);
  });
  it("verifies exact completed Standard escalation evidence, not merely a self-hashed lineage", () => {
    const original = invocationFixture();
    const claim = escalationFixture(original);
    expect(validEscalation(claim, original.result)).toBe(true);
    expect(validEscalation(claim, null)).toBe(false);
    expect(
      validEscalation(claim, {
        ...original.result,
        descriptor: {
          ...original.result.descriptor,
          budgetDecisionId: "changed-budget",
        },
      }),
    ).toBe(false);
    expect(
      validEscalation(
        parseClaim({
          ...claim,
          inputDigest: digestStructuredValue("changed-input"),
        }),
        original.result,
      ),
    ).toBe(false);
  });
  it("rejects an unclaimed escalation route or substituted gateway identity", () => {
    const { claim, result } = invocationFixture();
    expect(() =>
      parseResult(
        {
          ...result,
          response: {
            ...result.response,
            provenance: {
              ...result.response.provenance,
              gatewayId: "unapproved.gateway",
            },
          },
        },
        claim,
        syntheticScope,
      ),
    ).toThrow(ModelRuntimePersistenceError);
    expect(() =>
      parseResult(
        {
          ...result,
          descriptor: {
            ...result.descriptor,
            routing: {
              ...result.descriptor.routing,
              routeId: "internal-escalation",
            },
          },
          usage: {
            ...result.usage,
            routing: {
              ...result.usage.routing,
              routeId: "internal-escalation",
            },
          },
        },
        claim,
        syntheticScope,
      ),
    ).toThrow(ModelRuntimePersistenceError);
  });
  it("parameters every scope predicate and fences before a new claim", async () => {
    const database = new ScriptedDatabase();
    const store = new PostgresModelInvocationStore({
      database,
      objects: unavailableObjects,
      scope: syntheticScope,
    });
    expect(await store.claim(invocationFixture().claim)).toEqual({
      kind: "claimed",
    });
    expect(database.statements[0]?.text).toContain("pg_advisory_xact_lock");
    for (const statement of database.statements.filter(({ text }) =>
      text.includes("WHERE organization_id"),
    )) {
      expect(statement.text).not.toContain(syntheticScope.organizationId);
      expect(statement.values[0]).toBe(syntheticScope.organizationId);
      expect(statement.text).toContain("scope_sha256=$2");
    }
    const insert = database.statements.find(({ text }) =>
      text.startsWith("INSERT"),
    );
    expect(insert?.values.slice(2, 5)).toEqual([
      syntheticScope.projectId,
      syntheticScope.userId,
      "invocation-1",
    ]);
    expect(insert?.text).not.toContain("prompt");
  });
  it("rejects unbounded failure messages before SQL", async () => {
    const database = new ScriptedDatabase();
    const store = new PostgresModelInvocationStore({
      database,
      objects: unavailableObjects,
      scope: syntheticScope,
    });
    await expect(
      store.fail(invocationFixture().claim, "Provider said: private payload"),
    ).rejects.toThrow(ModelRuntimePersistenceError);
    expect(database.statements).toEqual([]);
  });
  it("pins additive migration0019 with exact immutable terminal and owner-object constraints", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0019_model_runtime_invocation_persistence.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const manifest = JSON.parse(
      await readFile(
        new URL("../../../migrations/manifest.json", import.meta.url),
        "utf8",
      ),
    ) as {
      migrations: { version: string; file: string; checksumSha256: string }[];
    };
    expect(
      manifest.migrations.find(({ version }) => version === "0019"),
    ).toEqual({
      version: "0019",
      file: "0019_model_runtime_invocation_persistence.sql",
      checksumSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(source).toContain(
      "UNIQUE (organization_id, scope_sha256, escalation_lineage_sha256)",
    );
    expect(source).toContain("OLD.state <> 'in-progress'");
    expect(source).toContain(
      "object_purpose = 'report' AND lifecycle_state = 'published'",
    );
    expect(source).not.toContain("CREATE TABLE credit");
  });
});
