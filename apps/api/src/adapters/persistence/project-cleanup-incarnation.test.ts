import { describe, expect, it, vi } from "vitest";
import { createCleanupDatabaseIncarnationVerifier } from "./project-cleanup-incarnation.js";
const arn =
  "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql";
const resourceId = "cluster-ABCDEFGHIJKLMNOPQRSTUVWX";
describe("fresh management database identity", () => {
  it("uses a new authenticated observation for every warm invocation", async () => {
    const describe = vi.fn(() =>
      Promise.resolve({ clusters: [{ arn, resourceId }] }),
    );
    const verifier = createCleanupDatabaseIncarnationVerifier({
      expectedArn: arn,
      expectedResourceId: resourceId,
      describe,
    });
    await verifier.assertCurrent();
    await verifier.assertCurrent();
    expect(describe).toHaveBeenCalledTimes(2);
  });
  it.each(
    [
      [],
      [{ arn, resourceId: "cluster-OTHERABCDEFGHIJKLMNOPQRST" }],
      [{ arn: arn.replace("us-east-1", "us-west-2"), resourceId }],
      [{ arn: arn.replace("123456789012", "210987654321"), resourceId }],
      [
        {
          arn: arn.replace("beta-postgresql", "production-postgresql"),
          resourceId,
        },
      ],
      [
        { arn, resourceId },
        { arn, resourceId },
      ],
    ].map((clusters) => ({ clusters })),
  )(
    "quarantines missing, replaced, foreign or ambiguous identity %#",
    async ({ clusters }) => {
      const describe = vi.fn(() => Promise.resolve({ clusters }));
      await expect(
        createCleanupDatabaseIncarnationVerifier({
          expectedArn: arn,
          expectedResourceId: resourceId,
          describe,
        }).assertCurrent(),
      ).rejects.toThrow(/incarnation/);
      expect(describe).toHaveBeenCalledOnce();
    },
  );
  it("pins are captured immutably rather than read from a mutable caller object", async () => {
    const input = {
      expectedArn: arn,
      expectedResourceId: resourceId,
      describe: vi.fn(() =>
        Promise.resolve({ clusters: [{ arn, resourceId }] }),
      ),
    };
    const verifier = createCleanupDatabaseIncarnationVerifier(input);
    input.expectedResourceId = "cluster-OTHERABCDEFGHIJKLMNOPQRST";
    await expect(verifier.assertCurrent()).resolves.toBeUndefined();
    expect(Object.isFrozen(verifier)).toBe(true);
  });
  it("does not reuse a prior valid identity after management read failure", async () => {
    const describe = vi.fn(() =>
      Promise.resolve({ clusters: [{ arn, resourceId }] }),
    );
    const verifier = createCleanupDatabaseIncarnationVerifier({
      expectedArn: arn,
      expectedResourceId: resourceId,
      describe,
    });
    await verifier.assertCurrent();
    describe.mockRejectedValueOnce(Error("management unavailable"));
    await expect(verifier.assertCurrent()).rejects.toThrow(
      "management unavailable",
    );
    expect(describe).toHaveBeenCalledTimes(2);
  });
  it.each([
    {
      expectedArn: arn.replace("beta-postgresql", "production-postgresql"),
      expectedResourceId: resourceId,
    },
    { expectedArn: arn, expectedResourceId: "caller-asserted-generation" },
  ])("rejects invalid reviewed pins before management I/O %#", (pins) => {
    const describe = vi.fn();
    expect(() =>
      createCleanupDatabaseIncarnationVerifier({ ...pins, describe }),
    ).toThrow(/Invalid source/);
    expect(describe).not.toHaveBeenCalled();
  });
});
