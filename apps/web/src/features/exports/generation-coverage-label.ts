import type { ApiResponseV1 } from "@cloudmarkup/api-contract";

type SolutionExportJob = ApiResponseV1<"solution-export-jobs.get">["data"];

export function coverageLabel(
  state: SolutionExportJob["generationCoverage"]["state"],
): string {
  switch (state) {
    case "infrastructure-only":
      return "Infrastructure only";
    case "starter-application":
      return "Starter application";
    case "complete-supported-pattern":
      return "Complete supported pattern";
    case "ai-assisted-custom-validated":
      return "AI-assisted custom, validated";
    case "custom-implementation-required":
      return "Custom implementation required";
    case "target-unsupported":
      return "Target unsupported";
  }
}
