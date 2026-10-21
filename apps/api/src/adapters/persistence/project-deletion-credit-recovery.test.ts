import { describe, it, expect, vi } from "vitest";
// Capability-only unit test: this actual evidence reader must never be invoked.
// Its unmocked build/native gates remain with the coordinator.
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { PostgresModelCommercialAccountingEngine } from "./model-commercial-accounting-engine.js";
import {
  MODEL_ACCOUNTING_WINDOW_MAPPING,
  verifyModelAccountingRuntime,
} from "./model-commercial-accounting-codec.js";
import { parseRuntimeRecord } from "./model-runtime-admission-codec.js";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import type { SqlDatabase } from "./sql.js";
describe("deletion-only financial capability", () => {
  it("cannot reserve, reinterpret existing reservations, or accept ordinary terminal callbacks", async () => {
    const f = await modelAccountingFixture(),
      run = vi.fn(),
      query = vi.fn(),
      transaction = vi.fn();
    const database = {
      query,
      transaction,
      close: vi.fn(),
    } as unknown as SqlDatabase;
    const engine = new PostgresModelCommercialAccountingEngine({
      database,
      scope: f.scope,
      binding: {
        workflowId: f.request.multiCallWorkflowId,
        workflowFingerprint: f.fingerprint,
        runtimeScopeDigest: digestStructuredValue("runtime-scope"),
        runtimeFingerprint: digestStructuredValue("runtime"),
      },
      mapping: MODEL_ACCOUNTING_WINDOW_MAPPING,
      parseRuntime: parseRuntimeRecord,
      verifyRuntime: verifyModelAccountingRuntime,
      deletionTerminalTransactions: { run },
    });
    await expect(engine.reserve(f.input)).rejects.toThrow();
    await expect(engine.recoverExistingReservation(f.input)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
