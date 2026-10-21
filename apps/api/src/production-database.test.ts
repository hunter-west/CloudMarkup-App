import {
  ExecuteStatementCommand,
  RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { describe, expect, it, vi } from "vitest";
import {
  createProductionDatabase,
  readProductionResumePolicy,
  type ProductionDatabaseHost,
} from "./production-database.js";
import { sql } from "./adapters/persistence/sql.js";
const binding = {
  database: "cloudmarkup",
  resourceArn:
    "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql",
  secretArn:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:cloudmarkup-beta/database/admin-test",
};
describe("explicit production database resume wiring", () => {
  it.each([undefined, "false"])(
    "retains original client sends without policy for %s",
    async (flag) => {
      const client = new RDSDataClient({ maxAttempts: 1 });
      const send = vi
        .spyOn(client, "send")
        .mockResolvedValue({ formattedRecords: "[]" } as never);
      const environment: NodeJS.ProcessEnv = {};
      if (flag !== undefined)
        environment["CLOUDMARKUP_AURORA_RESUME_ENABLED"] = flag;
      await createProductionDatabase(
        { ...binding, client },
        environment,
        "api",
      ).query(sql("SELECT 1"));
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]).toHaveLength(1);
    },
  );
  it.each([
    "api",
    "billing",
    "proposal",
    "export",
    "cleanup",
    "cleanup-wake",
  ] as const)("budgets %s explicitly", (host: ProductionDatabaseHost) => {
    const policy = readProductionResumePolicy({
      ...binding,
      host,
      environment: {
        CLOUDMARKUP_ENVIRONMENT: "beta",
        CLOUDMARKUP_AURORA_RESUME_ENABLED: "true",
      },
    });
    expect(policy?.maxElapsedMilliseconds).toBe(
      host === "api" ? 20_000 : host === "billing" ? 30_000 : 45_000,
    );
    expect(policy?.maxAttempts).toBe(20);
  });
  it.each(["TRUE", " true", "1", ""])("rejects invalid flag %s", (flag) => {
    expect(() =>
      readProductionResumePolicy({
        ...binding,
        host: "api",
        environment: {
          CLOUDMARKUP_ENVIRONMENT: "beta",
          CLOUDMARKUP_AURORA_RESUME_ENABLED: flag,
        },
      }),
    ).toThrow();
  });
  it.each(["prod", "staging", undefined])(
    "rejects nonbeta activation %s",
    (environment) => {
      expect(() =>
        readProductionResumePolicy({
          ...binding,
          host: "api",
          environment: {
            CLOUDMARKUP_ENVIRONMENT: environment,
            CLOUDMARKUP_AURORA_RESUME_ENABLED: "true",
          },
        }),
      ).toThrow();
    },
  );
  it("rejects a different cluster or database", () => {
    for (const changed of [
      { ...binding, database: "other" },
      {
        ...binding,
        resourceArn: binding.resourceArn.replace(
          "beta-postgresql",
          "prod-postgresql",
        ),
      },
    ])
      expect(() =>
        readProductionResumePolicy({
          ...changed,
          host: "api",
          environment: {
            CLOUDMARKUP_ENVIRONMENT: "beta",
            CLOUDMARKUP_AURORA_RESUME_ENABLED: "true",
          },
        }),
      ).toThrow();
  });
  it("requires one SDK attempt for an enabled host and preserves ambiguity", async () => {
    const environment = {
      CLOUDMARKUP_ENVIRONMENT: "beta",
      CLOUDMARKUP_AURORA_RESUME_ENABLED: "true",
    };
    const unsafe = new RDSDataClient({ maxAttempts: 3 });
    const unsafeSend = vi.spyOn(unsafe, "send");
    await expect(
      createProductionDatabase(
        { ...binding, client: unsafe },
        environment,
        "api",
      ).query(sql("SELECT 1")),
    ).rejects.toThrow();
    expect(unsafeSend).not.toHaveBeenCalled();
    const client = new RDSDataClient({ maxAttempts: 1 });
    const failure = Error("Transport outcome is uncertain");
    const send = vi.spyOn(client, "send").mockRejectedValue(failure);
    await expect(
      createProductionDatabase(
        { ...binding, client },
        environment,
        "api",
      ).query(sql("SELECT 1")),
    ).rejects.toBe(failure);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ExecuteStatementCommand);
  });
  it("passes a bounded abort signal for enabled nontransaction sends", async () => {
    const client = new RDSDataClient({ maxAttempts: 1 });
    const send = vi
      .spyOn(client, "send")
      .mockResolvedValue({ formattedRecords: "[]" } as never);
    await createProductionDatabase(
      { ...binding, client },
      {
        CLOUDMARKUP_ENVIRONMENT: "beta",
        CLOUDMARKUP_AURORA_RESUME_ENABLED: "true",
      },
      "api",
    ).query(sql("SELECT 1"));
    expect(send.mock.calls[0]?.[1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
