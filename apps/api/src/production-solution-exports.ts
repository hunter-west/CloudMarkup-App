import type { ObjectStore } from "./application/persistence.js";
import type { CloudMarkupApplication } from "./application/ports.js";
import type { ProductionIdentityApplication } from "./application/production-identity-application.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { ProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";
import { createProductionSolutionExportMutations } from "./production-solution-export-mutations.js";
import { createProductionSolutionExportReads } from "./production-solution-export-reads.js";
import { createProductionSolutionExportHost } from "./production-solution-export-host.js";
import { loadProductionSolutionExportProfile } from "./production-solution-export-profile.js";

/** Only the authenticated request authority supplies publisher ownership. */
export function createProductionSolutionExports(options: {
  readonly config: ProductionSolutionExportEnvironment;
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly identity: Pick<
    ProductionIdentityApplication,
    "organizationForProject"
  >;
  readonly revisions: Pick<CloudMarkupApplication, "getSolutionRevision">;
}) {
  let admitted:
    ReturnType<typeof loadProductionSolutionExportProfile> | undefined;
  return {
    ...createProductionSolutionExportReads(options),
    ...createProductionSolutionExportMutations({
      ...options,
      host: async ({ principal, ownership }) => {
        admitted ??= loadProductionSolutionExportProfile(options.config);
        return createProductionSolutionExportHost({
          config: options.config,
          database: options.database,
          objectStore: options.objectStore,
          admitted: await admitted,
          ownership,
          principalId: principal.principalId,
        });
      },
    }),
  };
}
