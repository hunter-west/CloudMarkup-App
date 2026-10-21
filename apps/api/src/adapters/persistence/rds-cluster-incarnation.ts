import {
  DescribeDBClustersCommand,
  RDSClient,
  type DescribeDBClustersCommandOutput,
} from "@aws-sdk/client-rds";

interface ClusterManagementClient {
  send(
    command: DescribeDBClustersCommand,
    options: { readonly abortSignal: AbortSignal },
  ): Promise<Pick<DescribeDBClustersCommandOutput, "DBClusters" | "Marker">>;
}

const requestBudgetMilliseconds = 5_000;

/** A restored cluster can retain its name and ARN. Only a fresh management
 * response with the reviewed immutable resource ID admits this SQL host. */
export function createRdsClusterIncarnationVerifier(input: {
  readonly expectedArn: string;
  readonly expectedResourceId: string;
  readonly client?: ClusterManagementClient;
}): { assertCurrent(): Promise<void> } {
  const { expectedArn, expectedResourceId } = input;
  const arn =
    /^arn:aws:rds:([a-z]{2}-[a-z]+-\d):\d{12}:cluster:cloudmarkup-beta-postgresql$/u.exec(
      expectedArn,
    );
  const region = arn?.[1];
  if (
    region === undefined ||
    !/^cluster-[A-Za-z0-9]{16,64}$/u.test(expectedResourceId)
  )
    throw new Error("Invalid source database incarnation.");

  const client =
    input.client ??
    new RDSClient({
      region,
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: 2_000,
        requestTimeout: requestBudgetMilliseconds,
      },
    });

  return Object.freeze({
    async assertCurrent() {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("Database incarnation verification timed out."));
          }, requestBudgetMilliseconds);
        });
        const response = await Promise.race([
          client.send(
            new DescribeDBClustersCommand({
              DBClusterIdentifier: expectedArn,
              IncludeShared: false,
              MaxRecords: 20,
            }),
            { abortSignal: controller.signal },
          ),
          deadline,
        ]);
        const cluster = response.DBClusters?.[0];
        if (
          (response.Marker !== undefined && response.Marker !== "") ||
          response.DBClusters?.length !== 1 ||
          cluster?.DBClusterArn !== expectedArn ||
          cluster.DbClusterResourceId !== expectedResourceId
        )
          throw new Error("Database incarnation changed.");
      } catch {
        // SDK errors can include request and credential details. Expose only
        // the admission result; a failed read grants no restored-SQL authority.
        throw new Error(
          "Database incarnation could not be verified; restore is quarantined.",
        );
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  });
}
