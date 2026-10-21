import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  type RDSDataClient,
} from "@aws-sdk/client-rds-data";

import { RdsDataApiDatabase } from "./rds-data-driver.js";

/** Synthetic SDK responses decoded by the production Data API adapter. */
export function createDataApiJsonDatabase(
  rows: readonly (readonly object[])[],
) {
  const commands: ExecuteStatementCommand[] = [];
  const client = {
    destroy() {
      return undefined;
    },
    send(command: unknown) {
      if (command instanceof BeginTransactionCommand)
        return Promise.resolve({ transactionId: "synthetic-transaction" });
      if (
        command instanceof CommitTransactionCommand ||
        command instanceof RollbackTransactionCommand
      )
        return Promise.resolve({});
      if (!(command instanceof ExecuteStatementCommand))
        throw Error("Unexpected synthetic command");
      commands.push(command);
      const result = rows[commands.length - 1];
      if (result === undefined) throw Error("Unexpected synthetic query");
      return Promise.resolve({
        formattedRecords: JSON.stringify(result),
        numberOfRecordsUpdated: 0,
      });
    },
  } as unknown as RDSDataClient;
  return {
    commands,
    database: new RdsDataApiDatabase({
      client,
      database: "cloudmarkup",
      resourceArn: "arn:aws:rds:us-east-1:111111111111:cluster:synthetic",
      secretArn:
        "arn:aws:secretsmanager:us-east-1:111111111111:secret:synthetic",
    }),
  };
}
