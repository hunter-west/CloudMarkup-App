import { describe, expect, it, vi } from "vitest";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";

const expectedArn =
  "arn:aws:rds:us-east-1:111122223333:cluster:cloudmarkup-beta-postgresql";
const expectedResourceId = "cluster-ABCDEFGHIJKLMNOPQRSTUVWX123456";
type ManagementSend = NonNullable<
  Parameters<typeof createProductionCleanupIncarnation>[1]
>["send"];
function environment(): NodeJS.ProcessEnv {
  return {
    AWS_REGION: "us-east-1",
    CLOUDMARKUP_ACCOUNT_ID: "111122223333",
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: "true",
    CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "true",
    CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "true",
    CLOUDMARKUP_DELETION_RECOVERY_ENABLED: "true",
    CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID:
      "123e4567-e89b-12d3-a456-426614174000",
    CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID: expectedResourceId,
    CLOUDMARKUP_DATABASE_ARN: expectedArn,
    CLOUDMARKUP_CLEANUP_WAKE_TABLE: "cloudmarkup-beta-cleanup-wakes",
  };
}
describe("production cleanup management bridge", () => {
  it.each([undefined, "false"])(
    "keeps history %s inactive without transport",
    (flag) => {
      const send = vi.fn<ManagementSend>(() =>
        Promise.reject(new Error("Unexpected call.")),
      );
      expect(
        createProductionCleanupIncarnation(
          flag === undefined
            ? {}
            : { CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: flag },
          { send },
        ),
      ).toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("captures immutable pins and rejects a freshly replaced cluster", async () => {
    const configuration = environment();
    const send = vi
      .fn<ManagementSend>()
      .mockResolvedValueOnce({
        DBClusters: [
          {
            DBClusterArn: expectedArn,
            DbClusterResourceId: expectedResourceId,
          },
        ],
      })
      .mockResolvedValueOnce({
        DBClusters: [
          {
            DBClusterArn: expectedArn,
            DbClusterResourceId: "cluster-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
          },
        ],
      });
    const port = createProductionCleanupIncarnation(configuration, { send });
    if (port === undefined) throw new Error("Missing production bridge.");
    expect(Object.isFrozen(port)).toBe(true);
    configuration["CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID"] =
      "cluster-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
    await port.assertCurrent();
    await expect(port.assertCurrent()).rejects.toThrow(
      "restore is quarantined",
    );
    expect(port.expectedResourceId).toBe(expectedResourceId);
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) {
      expect(call[0]).toMatchObject({
        input: {
          DBClusterIdentifier: expectedArn,
          IncludeShared: false,
          MaxRecords: 20,
        },
      });
    }
  });
  it("rejects an incomplete activation profile before management I/O", () => {
    const configuration = environment();
    delete configuration["CLOUDMARKUP_DELETION_RECOVERY_ENABLED"];
    const send = vi.fn<ManagementSend>(() =>
      Promise.reject(new Error("Unexpected call.")),
    );
    expect(() =>
      createProductionCleanupIncarnation(configuration, { send }),
    ).toThrow("activation configuration is invalid");
    expect(send).not.toHaveBeenCalled();
  });
});
