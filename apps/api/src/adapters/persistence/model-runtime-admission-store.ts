import type {
  ModelRuntimeAdmissionStoreV1,
  ModelRuntimeAdmissionTerminalV1,
} from "@cloudmarkup/model-gateway";
import type {
  ModelRuntimeAdmissionRequestV1,
  ModelRuntimeAdmissionDecisionV1,
} from "@cloudmarkup/schemas";
import { PostgresRuntimeAdmissionEngine } from "./model-runtime-admission-engine.js";
import {
  parseRuntimeClaim,
  parseRuntimeRecord,
  parseRuntimeStateRequest,
  parseRuntimeTerminal,
  type RuntimeAdmissionScope,
} from "./model-runtime-admission-codec.js";
import type { SqlDatabase } from "./sql.js";

/** Strict normal-execution adapter. Current authenticated host scope is mandatory;
 * this adapter cannot approve live evaluation, reserve credits or invoke a model. */
export class PostgresModelRuntimeAdmissionStore
  extends PostgresRuntimeAdmissionEngine<
    ModelRuntimeAdmissionRequestV1,
    ModelRuntimeAdmissionDecisionV1,
    ModelRuntimeAdmissionTerminalV1
  >
  implements ModelRuntimeAdmissionStoreV1
{
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: RuntimeAdmissionScope;
  }) {
    super({
      database: input.database,
      scope: input.scope,
      codec: {
        version: 1,
        parseClaim: parseRuntimeClaim,
        parseRecord: parseRuntimeRecord,
        parseState: parseRuntimeStateRequest,
        parseTerminal: parseRuntimeTerminal,
      },
    });
  }
}
