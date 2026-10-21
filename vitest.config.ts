import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: repositoryRoot,
  test: {
    clearMocks: true,
    // Windows child-process workers can stall during startup. Threads retain
    // per-file isolation; Linux CI continues to use process workers.
    pool: process.platform === "win32" ? "threads" : "forks",
    coverage: {
      clean: true,
      include: [
        "apps/api/src/**/*.{ts,tsx}",
        "packages/application-build-runner/src/**/*.ts",
        "packages/ai-extension-generation/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}",
        "packages/api-contract/src/**/*.ts",
        "packages/application-generator/src/**/*.ts",
        "packages/architecture-cli/src/**/*.ts",
        "packages/customer-ci-workflow/src/**/*.ts",
        "packages/deployment-inputs/src/**/*.ts",
        "packages/diagram-export/src/**/*.ts",
        "packages/github-repository-export/src/**/*.ts",
        "packages/repository-importer/src/**/*.ts",
        "packages/solution-export/src/**/*.ts",
        "packages/solution-export-workflow/src/**/*.ts",
        "packages/domain/src/**/*.ts",
        "packages/graph-preparation/src/**/*.ts",
        "packages/terraform-validation-runner/src/**/*.ts",
        "infra/platform/{bin,lib,runtime}/**/*.ts",
        "packages/job-framework/src/**/*.ts",
        "packages/model-gateway/src/**/*.ts",
        "packages/provider-aws/src/**/*.ts",
        "packages/provider-sdk/src/**/*.ts",
        "packages/schemas/src/**/*.ts",
        "packages/ui/src/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.test.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
    projects: [
      {
        extends: true,
        test: {
          environment: "node",
          include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
          name: "platform",
          root: fileURLToPath(new URL("./infra/platform", import.meta.url)),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          // Root CLI hookTimeout is not inherited by project configs.
          hookTimeout: 120_000,
          name: "api",
          root: fileURLToPath(new URL("./apps/api", import.meta.url)),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          hookTimeout: 120_000,
          name: "api-contract",
          root: fileURLToPath(
            new URL("./packages/api-contract", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "application-build-runner",
          root: fileURLToPath(
            new URL("./packages/application-build-runner", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "ai-extension-generation",
          root: fileURLToPath(
            new URL("./packages/ai-extension-generation", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "application-generator",
          root: fileURLToPath(
            new URL("./packages/application-generator", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "deployment-inputs",
          root: fileURLToPath(
            new URL("./packages/deployment-inputs", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "architecture-cli",
          root: fileURLToPath(
            new URL("./packages/architecture-cli", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "customer-ci-workflow",
          root: fileURLToPath(
            new URL("./packages/customer-ci-workflow", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "diagram-export",
          root: fileURLToPath(
            new URL("./packages/diagram-export", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "repository-importer",
          root: fileURLToPath(
            new URL("./packages/repository-importer", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          hookTimeout: 120_000,
          name: "github-repository-export",
          root: fileURLToPath(
            new URL("./packages/github-repository-export", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "solution-export",
          root: fileURLToPath(
            new URL("./packages/solution-export", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "solution-export-workflow",
          root: fileURLToPath(
            new URL("./packages/solution-export-workflow", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "terraform-validation-runner",
          root: fileURLToPath(
            new URL("./packages/terraform-validation-runner", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "model-gateway",
          root: fileURLToPath(
            new URL("./packages/model-gateway", import.meta.url),
          ),
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          name: "web",
          root: fileURLToPath(new URL("./apps/web", import.meta.url)),
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          name: "ui",
          root: fileURLToPath(new URL("./packages/ui", import.meta.url)),
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: [
            "packages/domain/src/**/*.test.ts",
            "packages/job-framework/src/**/*.test.ts",
            "packages/provider-aws/src/**/*.test.ts",
            "packages/provider-sdk/src/**/*.test.ts",
            "packages/schemas/src/**/*.test.ts",
          ],
          name: "contracts",
          root: repositoryRoot,
        },
      },
    ],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
  resolve: {
    alias: {
      "@cloudmarkup/api-contract": fileURLToPath(
        new URL("./packages/api-contract/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/application-build-runner/host-repair-seed": fileURLToPath(
        new URL(
          "./packages/application-build-runner/src/host-repair-seed.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/application-build-runner": fileURLToPath(
        new URL(
          "./packages/application-build-runner/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/application-generator/testing": fileURLToPath(
        new URL(
          "./packages/application-generator/src/test-fixtures.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/ai-extension-generation/presentation": fileURLToPath(
        new URL(
          "./packages/ai-extension-generation/src/presentation.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/ai-extension-generation": fileURLToPath(
        new URL(
          "./packages/ai-extension-generation/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/application-generator": fileURLToPath(
        new URL(
          "./packages/application-generator/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/customer-ci-workflow/testing": fileURLToPath(
        new URL(
          "./packages/customer-ci-workflow/src/testing.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/customer-ci-workflow": fileURLToPath(
        new URL(
          "./packages/customer-ci-workflow/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/diagram-export/contracts": fileURLToPath(
        new URL("./packages/diagram-export/src/contracts.ts", import.meta.url),
      ),
      "@cloudmarkup/diagram-export/conformance": fileURLToPath(
        new URL(
          "./packages/diagram-export/src/conformance.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/diagram-export": fileURLToPath(
        new URL("./packages/diagram-export/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/repository-importer": fileURLToPath(
        new URL("./packages/repository-importer/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/github-repository-export/contracts": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/contracts.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/repository-import": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/repository-import.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/repository-import-runner":
        fileURLToPath(
          new URL(
            "./packages/github-repository-export/src/repository-import-runner.ts",
            import.meta.url,
          ),
        ),
      "@cloudmarkup/github-repository-export/errors": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/errors.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/ports": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/ports.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/service": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/service.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/testing": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/fakes.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export/webhook": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/webhook.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/github-repository-export": fileURLToPath(
        new URL(
          "./packages/github-repository-export/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/job-framework": fileURLToPath(
        new URL("./packages/job-framework/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/model-gateway/server-byok": fileURLToPath(
        new URL(
          "./packages/model-gateway/src/server-byok-entry.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/model-gateway/testing": fileURLToPath(
        new URL("./packages/model-gateway/src/fakes.ts", import.meta.url),
      ),
      "@cloudmarkup/model-gateway": fileURLToPath(
        new URL("./packages/model-gateway/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/graph-preparation": fileURLToPath(
        new URL("./packages/graph-preparation/src", import.meta.url),
      ),
      "@cloudmarkup/provider-aws/proposals": fileURLToPath(
        new URL(
          "./packages/provider-aws/src/proposal-preparation",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/provider-sdk/compiler": fileURLToPath(
        new URL("./packages/provider-sdk/src/compiler.ts", import.meta.url),
      ),
      "@cloudmarkup/provider-aws/testing/diagram-icon-registry": fileURLToPath(
        new URL(
          "./packages/provider-aws/src/diagram-icon-registry.test-support.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/provider-aws/catalog": fileURLToPath(
        new URL(
          "./packages/provider-aws/src/catalog-v1-accessors.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/provider-sdk": fileURLToPath(
        new URL("./packages/provider-sdk/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/schemas": fileURLToPath(
        new URL("./packages/schemas/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/solution-export/retained-artifact": fileURLToPath(
        new URL(
          "./packages/solution-export/src/retained-artifact.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/solution-export/contracts": fileURLToPath(
        new URL("./packages/solution-export/src/contracts.ts", import.meta.url),
      ),
      "@cloudmarkup/solution-export/security": fileURLToPath(
        new URL("./packages/solution-export/src/security.ts", import.meta.url),
      ),
      "@cloudmarkup/solution-export": fileURLToPath(
        new URL("./packages/solution-export/src/index.ts", import.meta.url),
      ),
      "@cloudmarkup/solution-export-workflow/contracts": fileURLToPath(
        new URL(
          "./packages/solution-export-workflow/src/public-contracts.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/solution-export-workflow/testing": fileURLToPath(
        new URL(
          "./packages/solution-export-workflow/src/testing.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/solution-export-workflow": fileURLToPath(
        new URL(
          "./packages/solution-export-workflow/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/terraform-validation-runner": fileURLToPath(
        new URL(
          "./packages/terraform-validation-runner/src/index.ts",
          import.meta.url,
        ),
      ),
      "@cloudmarkup/ui": fileURLToPath(
        new URL("./packages/ui/src/index.ts", import.meta.url),
      ),
    },
  },
});
