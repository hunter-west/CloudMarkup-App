import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionApp } from "./production-composition.js";
import { createRepositoryBackedSolutionApplicationOverrides } from "./application/repository-backed-solution-application.js";
import { loadProductionSolutionExportProfile } from "./production-solution-export-profile.js";
import { exportRunFixture } from "./adapters/persistence/solution-export-run-test-helpers.js";
import {
  PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
  PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
  PRODUCTION_SOLUTION_EXPORT_PROFILE,
} from "./production-solution-export-environment.js";

vi.mock("./production-solution-export-profile.js", () => ({
  loadProductionSolutionExportProfile: vi.fn(),
}));
vi.mock(
  "./application/repository-backed-solution-application.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./application/repository-backed-solution-application.js")
      >();
    return {
      ...actual,
      createRepositoryBackedSolutionApplicationOverrides: vi.fn(
        actual.createRepositoryBackedSolutionApplicationOverrides,
      ),
    };
  },
);
afterEach(() => {
  vi.clearAllMocks();
});
function environment(enabled: "absent" | "false" | "true"): NodeJS.ProcessEnv {
  return {
    CLOUDMARKUP_RUNTIME_COMPOSITION: "production-v1",
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    AWS_REGION: "us-east-1",
    CLOUDMARKUP_DATABASE_ARN:
      "arn:aws:rds:us-east-1:123456789012:cluster:synthetic",
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:synthetic",
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: "cloudmarkup-beta-synthetic-content",
    CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
    CLOUDMARKUP_OBJECT_EVIDENCE_PREFIX: "evidence/v1/organizations/",
    COGNITO_USER_POOL_ID: "us-east-1_synthetic",
    COGNITO_APP_CLIENT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
    COGNITO_REQUIRED_SCOPE: "cloudmarkup-api/access",
    COGNITO_ISSUER:
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_synthetic",
    CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG: JSON.stringify({
      schemaVersion: 1,
      authentication: {
        provider: "cognito",
        clientId: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        domain: "https://cloudmarkup-beta.auth.us-east-1.amazoncognito.com",
        callbackUrl: "https://beta.example.invalid/auth/callback",
        logoutUrl: "https://beta.example.invalid/",
        scopes: ["openid", "profile", "cloudmarkup-api/access"],
      },
    }),
    ...(enabled === "absent"
      ? {}
      : {
          CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: enabled,
          CLOUDMARKUP_SOLUTION_EXPORT_PROFILE:
            PRODUCTION_SOLUTION_EXPORT_PROFILE,
          CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN:
            "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-solution-exports.fifo",
          CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL:
            "https://sqs.us-east-1.amazonaws.com/123456789012/cloudmarkup-beta-solution-exports.fifo",
          CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
            PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
          CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256: "a".repeat(64),
          CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
            PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
          CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256: "b".repeat(64),
          CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST:
            "sha256:" + "c".repeat(64),
        }),
  };
}
describe("production new-revision tool selection", () => {
  it.each(["absent", "false", "true"] as const)(
    "registers freeze tool selection only for enabled exports (%s)",
    async (enabled) => {
      createProductionApp(environment(enabled));
      const options = vi
        .mocked(createRepositoryBackedSolutionApplicationOverrides)
        .mock.calls.at(-1)?.[0];
      expect(options).toBeDefined();
      expect(loadProductionSolutionExportProfile).not.toHaveBeenCalled();
      if (enabled !== "true") {
        expect(options?.selectToolsForFreeze).toBeUndefined();
        return;
      }
      const targetSettings =
        exportRunFixture("cloudformation").record.workflowSubmission.request
          .targetSettings;
      // Composition metadata only; byte admission/native execution have real separate proofs.
      vi.mocked(loadProductionSolutionExportProfile).mockResolvedValue({
        targetSettings,
      } as Awaited<ReturnType<typeof loadProductionSolutionExportProfile>>);
      const first = await options?.selectToolsForFreeze?.();
      const second = await options?.selectToolsForFreeze?.();
      expect(first).toEqual({
        compiler: {
          state: "pinned",
          tool: targetSettings.stageDescriptors.compiler.adapter,
        },
        diagramRenderer: {
          state: "pinned",
          tool: targetSettings.stageDescriptors.diagramRenderer.adapter,
        },
      });
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(second?.compiler).not.toBe(first?.compiler);
      expect(loadProductionSolutionExportProfile).toHaveBeenCalledOnce();
    },
  );
  it("propagates failed actual profile admission without a fallback tool selection", async () => {
    createProductionApp(environment("true"));
    const options = vi
      .mocked(createRepositoryBackedSolutionApplicationOverrides)
      .mock.calls.at(-1)?.[0];
    vi.mocked(loadProductionSolutionExportProfile).mockRejectedValue(
      new Error("Admitted asset unavailable"),
    );
    await expect(options?.selectToolsForFreeze?.()).rejects.toThrow(
      "Admitted asset unavailable",
    );
  });
});
