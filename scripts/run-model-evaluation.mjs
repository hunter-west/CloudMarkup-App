#!/usr/bin/env node

import {
  ModelEvaluationError,
  defaultModelEvaluationPolicyDigestV1,
  formatModelEvaluationReportSummaryV1,
  frozenModelEvaluationDatasetV1,
  runFrozenEventingApplicationEvaluationV4,
  runFrozenEventingEvaluationV3,
  runFrozenDeterministicModelEvaluationV1,
} from "../packages/model-gateway/dist/index.js";
import { runFrozenModelNetworkingEvaluationV2 } from "../packages/model-gateway/dist/networking-evaluation-production-v2.js";

const argumentsProvided = process.argv.slice(2);
if (argumentsProvided.length > 0) {
  process.stderr.write(
    "The deterministic model-evaluation runner accepts no provider, adapter, or live-mode arguments.\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await runFrozenDeterministicModelEvaluationV1();
    const networkingResult = await runFrozenModelNetworkingEvaluationV2();
    const eventingResult = runFrozenEventingEvaluationV3();
    const eventingApplicationResult =
      runFrozenEventingApplicationEvaluationV4();
    if (
      result.report.executionMode !== "deterministic-fake" ||
      !result.report.normalCi ||
      result.report.liveEvaluationAuthorityDigest !== undefined ||
      result.report.datasetDigest !==
        frozenModelEvaluationDatasetV1.datasetDigest ||
      result.report.evaluationPolicyDigest !==
        defaultModelEvaluationPolicyDigestV1 ||
      !networkingResult.deterministicPassed ||
      !eventingResult.deterministicPassed ||
      !eventingApplicationResult.deterministicPassed
    ) {
      throw new ModelEvaluationError(
        "model-evaluation.cli-authority-mismatch",
        "The normal evaluation command produced a non-canonical deterministic report.",
      );
    }
    process.stdout.write(`${formatModelEvaluationReportSummaryV1(result)}\n`);
    if (!result.report.deterministicPassed) process.exitCode = 1;
  } catch (error) {
    const code =
      error instanceof ModelEvaluationError
        ? error.code
        : "model-evaluation.unexpected-failure";
    process.stderr.write(`Deterministic model evaluation failed (${code}).\n`);
    process.exitCode = 1;
  }
}
