import type { S3Client } from "@aws-sdk/client-s3";
import { createProductionCleanupHistory } from "./production-cleanup-history.js";
import { S3ObjectStore } from "./adapters/persistence/s3-object-store.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
export function optionalProductionDeletionRecovery(
  environment: NodeJS.ProcessEnv,
  database: SqlDatabase,
  input: { bucket: string; client: S3Client },
) {
  const flag = environment["CLOUDMARKUP_DELETION_RECOVERY_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (flag !== "true") throw Error("Invalid deletion recovery configuration.");
  const history = createProductionCleanupHistory(environment);
  if (history === undefined)
    throw Error("Deletion recovery requires durable history.");
  let recovery:
    | Promise<
        ReturnType<
          typeof import("./adapters/persistence/project-deletion-recovery.js").createProjectDeletionRecovery
        >
      >
    | undefined;
  const read = () =>
    (recovery ??=
      import("./adapters/persistence/project-deletion-recovery.js").then(
        ({ createProjectDeletionRecovery }) =>
          createProjectDeletionRecovery({
            database,
            history,
            objects: new S3ObjectStore({
              ...input,
              requireDefinitiveStage: true,
              keyPrefix: "documents/v1/organizations/",
            }),
          }),
      ));
  return {
    drain: async (
      binding: import("./adapters/persistence/s3-project-content-eraser.js").ProjectErasureBinding,
    ) => (await read()).drain(binding),
    assertSealed: async (
      binding: import("./adapters/persistence/s3-project-content-eraser.js").ProjectErasureBinding,
    ) => (await read()).assertSealed(binding),
  };
}
