import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertCloudMarkupWorkflowTemplate } from "./workflow-policy.js";

const templatePath = fileURLToPath(
  new URL("../templates/cloudmarkup-validate.yml", import.meta.url),
);

describe("credential-free CloudMarkup workflow template", () => {
  it("uses exact read-only permissions, full action pins, bounded commands, and Evidence upload", async () => {
    const source = await readFile(templatePath, "utf8");
    expect(() => {
      assertCloudMarkupWorkflowTemplate(source);
    }).not.toThrow();
    expect(source).not.toMatch(
      /(?:AWS_|AZURE_|GOOGLE_|secrets\.|pull_request_target)/u,
    );
  });

  it.each([
    ["fork credential", "permissions:\n  contents: write"],
    ["unpinned action", "uses: actions/checkout@main"],
    ["customer planning", "run: terraform plan"],
    ["customer deployment", "run: terraform apply"],
    ["secret reference", "run: echo ${{ secrets.AWS_ACCESS_KEY_ID }}"],
    ["network download", "run: curl https://example.invalid/tool"],
  ])("rejects %s", async (_label, malicious) => {
    const source = await readFile(templatePath, "utf8");
    const candidate = malicious.startsWith("uses:")
      ? source.replace(
          "uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
          malicious,
        )
      : `${source}\n${malicious}\n`;
    expect(() => {
      assertCloudMarkupWorkflowTemplate(candidate);
    }).toThrow();
  });
});
