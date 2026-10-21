import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{ts,tsx}"];
const webFiles = ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "testdata/generation-goldens-v1/goldens/**",
      "**/cdk.out/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/storybook-static/**",
      "**/.turbo/**",
      "packages/application-build-runner/.reviewed-event-build-*/**",
      "packages/application-build-runner/.reviewed-http-no-content-build-*/**",
      "packages/application-build-runner/.reviewed-notes-build-*/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: sourceFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "config/playwright/beta-smoke.config.ts",
            "config/playwright/default.config.ts",
            "config/playwright/desktop-production.config.ts",
            "config/playwright/typed-backend.config.ts",
            "config/playwright/solution-export.config.ts",
            "config/playwright/editor-performance.config.ts",
            "config/playwright/app-shell-refinement.config.ts",
            "scripts/beta-smoke/*.ts",
            "evals/datasets-full-beta-v1/repositories/ambiguous-source-code-inference/application/ambiguous-handler.ts",
          ],
          defaultProject: "config/typescript/playwright.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: webFiles,
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{cjs,js,mjs}"],
  },
  {
    files: ["**/*.{cjs,js,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettier,
);
