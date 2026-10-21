/** Management observations are fresh on every call; immutable reviewed pins
 * are never replaced by environment, restored SQL or a previous observation. */
export interface CleanupDatabaseIncarnationPort {
  readonly expectedArn: string;
  readonly expectedResourceId: string;
  assertCurrent(): Promise<void>;
}
export function createCleanupDatabaseIncarnationVerifier(input: {
  expectedArn: string;
  expectedResourceId: string;
  describe: () => Promise<{
    readonly clusters: readonly {
      readonly arn: string;
      readonly resourceId: string;
    }[];
  }>;
}): CleanupDatabaseIncarnationPort {
  const { expectedArn, expectedResourceId, describe } = input;
  if (
    !/^arn:aws:rds:[a-z]{2}-[a-z]+-\d:\d{12}:cluster:cloudmarkup-beta-postgresql$/u.test(
      expectedArn,
    ) ||
    !/^cluster-[A-Za-z0-9]{16,64}$/u.test(expectedResourceId)
  )
    throw Error("Invalid source database incarnation.");
  return Object.freeze({
    expectedArn,
    expectedResourceId,
    async assertCurrent() {
      const result = await describe();
      if (
        result.clusters.length !== 1 ||
        result.clusters[0]?.arn !== expectedArn ||
        result.clusters[0].resourceId !== expectedResourceId
      )
        throw Error("Database incarnation changed; restore is quarantined.");
    },
  });
}
