import type { SolutionExportWorkflowCancellationPollPort } from "./ports.js";

export const SOLUTION_EXPORT_CANCELLATION_POLL_MILLISECONDS = 250;

export function createTimerSolutionExportWorkflowCancellationPollPort(
  intervalMilliseconds = SOLUTION_EXPORT_CANCELLATION_POLL_MILLISECONDS,
): SolutionExportWorkflowCancellationPollPort {
  if (
    !Number.isSafeInteger(intervalMilliseconds) ||
    intervalMilliseconds < 1 ||
    intervalMilliseconds > 1_000
  ) {
    throw new TypeError(
      "Cancellation polling interval must be an integer from 1 to 1000 milliseconds.",
    );
  }

  return {
    wait({ signal }) {
      if (signal.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timeout = setTimeout(finish, intervalMilliseconds);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    },
  };
}
