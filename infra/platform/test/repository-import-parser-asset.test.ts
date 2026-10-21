import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import {
  buildRepositoryImportParser,
  createRepositoryImportParserLayer,
} from "../lib/repository-import-parser-asset.js";

it("cross-compiles reproducible Linux ARM64 bytes with no network or provider credentials", () => {
  const first = buildRepositoryImportParser();
  const second = buildRepositoryImportParser();
  expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.bytes.byteLength).toBeGreaterThan(1_000_000);
  expect(first.bytes.byteLength).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(second.sha256).toBe(first.sha256);
  expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
}, 120_000);

it("stages the exact digest-pinned parser and binds its layer to ARM64 Node 24", () => {
  const app = new App();
  const stack = new Stack(app, "ImportParserFixture");
  const packaged = createRepositoryImportParserLayer(stack);
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::Lambda::LayerVersion", {
    CompatibleArchitectures: ["arm64"],
    CompatibleRuntimes: ["nodejs24.x"],
  });
  expect(packaged.environment["CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED"]).toBe(
    "true",
  );
  expect(
    packaged.environment["CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH"],
  ).toBe("/opt/cloudmarkup-iac-import");
  const assembly = app.synth();
  const asset = stack.node.findAll().find((node) => "assetPath" in node);
  if (
    asset === undefined ||
    !("assetPath" in asset) ||
    typeof asset.assetPath !== "string"
  )
    throw new Error("The parser asset was not staged.");
  const bytes = readFileSync(
    join(assembly.directory, asset.assetPath, "cloudmarkup-iac-import"),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    packaged.environment["CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256"],
  );
  expect(JSON.stringify(template.toJSON())).not.toContain(assembly.directory);
}, 120_000);
