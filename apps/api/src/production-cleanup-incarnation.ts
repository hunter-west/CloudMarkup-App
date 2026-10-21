import { createRdsClusterIncarnationVerifier } from "./adapters/persistence/rds-cluster-incarnation.js";
import type { CleanupDatabaseIncarnationPort } from "./adapters/persistence/project-cleanup-incarnation.js";
import { readProductionCleanupHistory } from "./production-cleanup-history.js";

/** Capture reviewed physical identity once; every assertion performs new signed
 * management I/O. Disabled history creates neither a verifier nor a client. */
export function createProductionCleanupIncarnation(
  environment: NodeJS.ProcessEnv,
  client?: NonNullable<
    Parameters<typeof createRdsClusterIncarnationVerifier>[0]["client"]
  >,
): CleanupDatabaseIncarnationPort | undefined {
  const configuration = readProductionCleanupHistory(environment);
  if (configuration === undefined) return undefined;
  const expectedArn = `arn:aws:rds:${configuration.region}:${configuration.account}:cluster:cloudmarkup-beta-postgresql`;
  const expectedResourceId = configuration.resourceId;
  const management = createRdsClusterIncarnationVerifier({
    expectedArn,
    expectedResourceId,
    ...(client === undefined ? {} : { client }),
  });
  return Object.freeze({
    expectedArn,
    expectedResourceId,
    assertCurrent: management.assertCurrent.bind(management),
  });
}
