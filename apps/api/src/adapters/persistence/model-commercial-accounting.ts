import type { ModelCommercialVerifiedScopeV1 } from "@cloudmarkup/model-gateway";
import { PostgresModelCommercialAccountingEngine } from "./model-commercial-accounting-engine.js";
import {
  MODEL_ACCOUNTING_WINDOW_MAPPING,
  verifyModelAccountingRuntime,
  type ModelAccountingBinding,
} from "./model-commercial-accounting-codec.js";
import {
  parseRuntimeRecord,
  type RuntimeAdmissionRecord,
} from "./model-runtime-admission-codec.js";
import type { SqlDatabase } from "./sql.js";

/** Normal one-primary Standard Intent adapter. The host owns current session
 * authentication; the shared SQL engine additionally enforces tenant authority.
 * Undeclared mapping, codec or transaction hooks are never forwarded. */
export class PostgresModelCommercialReservations extends PostgresModelCommercialAccountingEngine<RuntimeAdmissionRecord> {
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: ModelCommercialVerifiedScopeV1;
    readonly binding: ModelAccountingBinding;
  }) {
    super({
      database: input.database,
      scope: input.scope,
      binding: input.binding,
      mapping: MODEL_ACCOUNTING_WINDOW_MAPPING,
      parseRuntime: parseRuntimeRecord,
      verifyRuntime: verifyModelAccountingRuntime,
    });
  }
}
