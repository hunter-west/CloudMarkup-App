import { createRequire } from "node:module";

const require = createRequire("/opt/cloudmarkup/toolchain/package.json");
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");

export default tseslint.config(
  {
    ignores: [
      "application/dist/**",
      "application/node_modules/**",
      "application/artifacts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["application/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./application/tsconfig.json",
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
);
