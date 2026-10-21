import {
  RDSClient,
  type DescribeDBClustersCommandOutput,
} from "@aws-sdk/client-rds";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRdsClusterIncarnationVerifier } from "./rds-cluster-incarnation.js";

type ManagementSend = NonNullable<
  Parameters<typeof createRdsClusterIncarnationVerifier>[0]["client"]
>["send"];

const expectedArn =
  "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql";
const expectedResourceId = "cluster-ABCDEFGHIJKLMNOPQRSTUVWX12";
const valid = {
  DBClusters: [
    { DBClusterArn: expectedArn, DbClusterResourceId: expectedResourceId },
  ],
};
const denied =
  "Database incarnation could not be verified; restore is quarantined.";

afterEach(() => vi.useRealTimers());

describe("fresh RDS cluster incarnation admission", () => {
  it("reads the exact cluster again on a warm host and refuses a restored incarnation", async () => {
    const send = vi
      .fn<ManagementSend>()
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce({
        DBClusters: [
          {
            ...valid.DBClusters[0],
            DbClusterResourceId: "cluster-ZYXWVUTSRQPONMLKJIHGFEDCBA",
          },
        ],
      });
    const verifier = createRdsClusterIncarnationVerifier({
      expectedArn,
      expectedResourceId,
      client: { send },
    });
    await verifier.assertCurrent();
    await expect(verifier.assertCurrent()).rejects.toThrow(denied);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [command, options] of send.mock.calls) {
      expect(command.input).toEqual({
        DBClusterIdentifier: expectedArn,
        IncludeShared: false,
        MaxRecords: 20,
      });
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    ["missing inventory", {}],
    ["empty inventory", { DBClusters: [] }],
    [
      "duplicate cluster",
      { DBClusters: [...valid.DBClusters, ...valid.DBClusters] },
    ],
    [
      "foreign ARN",
      {
        DBClusters: [
          {
            ...valid.DBClusters[0],
            DBClusterArn: expectedArn.replace("123456789012", "999999999999"),
          },
        ],
      },
    ],
    [
      "missing ARN",
      { DBClusters: [{ DbClusterResourceId: expectedResourceId }] },
    ],
    ["missing resource ID", { DBClusters: [{ DBClusterArn: expectedArn }] }],
    ["truncated inventory", { ...valid, Marker: "more-results" }],
  ] satisfies [
    string,
    Pick<DescribeDBClustersCommandOutput, "DBClusters" | "Marker">,
  ][])("refuses %s", async (_name, response) => {
    const send = vi.fn<ManagementSend>().mockResolvedValue(response);
    const verifier = createRdsClusterIncarnationVerifier({
      expectedArn,
      expectedResourceId,
      client: { send },
    });
    await expect(verifier.assertCurrent()).rejects.toThrow(denied);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { expectedArn: "cloudmarkup-beta-postgresql", expectedResourceId },
    {
      expectedArn: expectedArn.replace(
        "beta-postgresql",
        "customer-postgresql",
      ),
      expectedResourceId,
    },
    { expectedArn, expectedResourceId: "cloudmarkup-beta-postgresql" },
    { expectedArn, expectedResourceId: `${expectedResourceId} ` },
  ])(
    "refuses invalid pinned configuration before a request: %j",
    (configuration) => {
      const send = vi.fn<ManagementSend>();
      expect(() =>
        createRdsClusterIncarnationVerifier({
          ...configuration,
          client: { send },
        }),
      ).toThrow("Invalid source database incarnation.");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("refuses an unavailable or denied management read without exposing provider details", async () => {
    const send = vi
      .fn<ManagementSend>()
      .mockRejectedValue(new Error("sensitive provider request details"));
    const verifier = createRdsClusterIncarnationVerifier({
      expectedArn,
      expectedResourceId,
      client: { send },
    });
    await expect(verifier.assertCurrent()).rejects.toThrow(denied);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("aborts and refuses a stalled request within the five-second host budget", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<ManagementSend>()
      .mockImplementation(() => new Promise<never>(() => undefined));
    const verifier = createRdsClusterIncarnationVerifier({
      expectedArn,
      expectedResourceId,
      client: { send },
    });
    const result = expect(verifier.assertCurrent()).rejects.toThrow(denied);
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
    expect(send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the real SDK's signed management request and immutable ID response field", async () => {
    const handle = vi
      .fn()
      .mockImplementation(
        (request: {
          readonly body: unknown;
          readonly headers: Record<string, string>;
        }) => {
          expect(request.body).toContain("Action=DescribeDBClusters");
          expect(request.body).toContain(
            `DBClusterIdentifier=${encodeURIComponent(expectedArn)}`,
          );
          expect(request.headers["authorization"]).toContain(
            "/us-east-1/rds/aws4_request",
          );
          return Promise.resolve({
            response: {
              statusCode: 200,
              headers: { "content-type": "text/xml" },
              body: Readable.from([
                `<DescribeDBClustersResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><DescribeDBClustersResult><DBClusters><DBCluster><DBClusterArn>${expectedArn}</DBClusterArn><DbClusterResourceId>${expectedResourceId}</DbClusterResourceId></DBCluster></DBClusters></DescribeDBClustersResult></DescribeDBClustersResponse>`,
              ]),
            },
          });
        },
      );
    const client = new RDSClient({
      region: "us-east-1",
      maxAttempts: 1,
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      requestHandler: { handle },
    });
    try {
      await createRdsClusterIncarnationVerifier({
        expectedArn,
        expectedResourceId,
        client,
      }).assertCurrent();
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      client.destroy();
    }
  });
});
