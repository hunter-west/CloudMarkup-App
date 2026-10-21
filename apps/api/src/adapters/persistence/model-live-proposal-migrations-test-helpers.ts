import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { splitPostgresStatements } from "./migrations.js";
import { sql, type SqlDatabase } from "./sql.js";
import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";

// Synthetic isolated-schema setup only. Reuse registered SQL on the exact
// historical fixture without changing its migration ledger. Preserve that
// registered successor before and after each transaction.
function proposal(file: string, sha256: string, statementCount?: number) {
  return async (database: SqlDatabase): Promise<void> => {
    const source = await readFile(
      new URL("../../../migrations/" + file, import.meta.url),
      "utf8",
    );
    if (createHash("sha256").update(source).digest("hex") !== sha256)
      throw Error("Exact registered SQL bytes required: " + file);
    const statements = splitPostgresStatements(source);
    if (statementCount !== undefined && statements.length !== statementCount)
      throw Error("Exact registered SQL statement count required: " + file);
    await database.transaction(async (tx) => {
      await requireRegisteredEvaluationSuccessor(tx);
      for (const statement of statements) await tx.query(sql(statement));
      await requireRegisteredEvaluationSuccessor(tx);
    });
  };
}

export const applySeedValidationProposal = proposal(
  "0099_model_live_seed_validation_receipts.sql",
  "c1dbf93f7203742d6b2ab4e66d4aee75f7fbd3a8104649df1655c353f5ab3813",
  5,
);

export const applySeedStageInputProposal = proposal(
  "0100_model_live_sequence_inputs.sql",
  "6ee060d0612db919c0e3b239536dc653d4ee2abd19dcb07ce6445b40f83c9887",
  5,
);

export const applySeedRuntimeAdmissionProposal = proposal(
  "0101_model_live_seed_runtime_admissions.sql",
  "7e6cc4dad77b980ad4da45f27668ac67b5feb64aeec53b5c14aac24aafe23fc3",
);

export const applySeedCommercialReservationProposal = proposal(
  "0102_model_live_seed_commercial_reservations.sql",
  "5a2911d166649ae66f5f1bb6fce2641d239f52252de0fd1d3cc05d29030a9369",
);

export const applySeedSequenceRuntimeProposalV4 = proposal(
  "0103_model_live_seed_sequence_runtime.sql",
  "70c6aeb1c7d3c68fd3bb9aa38188175c058ab9d88bfe3fa71e84fa9ca2902df6",
);

export const applySeedSequenceReservationProposalV4 = proposal(
  "0104_model_live_seed_sequence_reservations.sql",
  "fc5fdd92d45d3916a4384dc4b603ab7776fa610521f80eac1dfadb7cde348102",
);

export const applySeedDispatchProposalV4 = proposal(
  "0105_model_live_sequence_attempt_journal.sql",
  "d1799be22c112e46e5367ddaa52dfe5c89164ba36b6edb2b06469c2b88f5edd4",
);

export const applySeedUsageObservationProposalV4 = proposal(
  "0106_model_live_sequence_usage_observations.sql",
  "a0bf9632244ed96aebc3da18a94b5493760960f16f45455f32724964c6c4fd3c",
);

export const applySeedCandidateValidationProposalV4 = proposal(
  "0107_model_live_sequence_candidate_validations.sql",
  "a53e18d111ea895a4afdf9e6a148c7113c71a65c95bb46eeb5126fd3af7d34ca",
);

export const applyRepairSuccessorInputProposalV4 = proposal(
  "0108_model_live_repair_successor_inputs.sql",
  "76d9ca4757267713350bf5eeab330a717bde09771733287bc080214be2ebfb72",
);

export const applyRepairSuccessorDispatchProposalV4 = proposal(
  "0109_model_live_repair_successor_dispatches.sql",
  "b84a134c976c88c259c0a7497d68ef42d7af7a3b19f97ed545ca264485196ba6",
);

export const applyRepairSuccessorUsageProposalV4 = proposal(
  "0110_model_live_repair_successor_usage_observations.sql",
  "de3e36f8e6275a88d26d8ebc500c997bce105974aa12fdf86b70292d54279b9b",
);

export const applyRepairSuccessorCandidateProposalV4 = proposal(
  "0111_model_live_repair_successor_candidate_validations.sql",
  "b3c3f65e86b92cde23f39876bd8374a21d9cc68470a32cfcdabb0291eb13af5e",
);

export const applyRepairUnusedStageProposalV4 = proposal(
  "0112_model_live_repair_unused_stages.sql",
  "a45ab3de5cf8f38bd976d328f0c35995bd1557234b622b411bd99d046d285411",
);

export const applyRepairRecordedReceiptProposalV4 = proposal(
  "0113_model_live_repair_recorded_receipts.sql",
  "143659bd3c33b762efda6dd9ff6fc17339e6d659db9b5d5f4c07d128e686ca92",
);

export const applyRepairTerminalAccountingProposalV4 = proposal(
  "0114_model_live_repair_terminal_accounting.sql",
  "7c9437612afc6fc58aeccc23d080bac7270a8b89c3edd9c743c3dbe781b5af10",
);

export const applyRepairKnownFailureProposalV4 = proposal(
  "0115_model_live_repair_known_failure.sql",
  "2b1cf22d575c2bd9e01866ad852ac02e334ecbeb067adf7060c9bdb32dc4eec0",
);

export const applyRepairExpiryProposalV4 = proposal(
  "0116_model_live_repair_expiry_receipts.sql",
  "b1bbf3edf4c094d2ae2ce1541b17090d0188f50463071725a34d70ff5dc93b23",
);
