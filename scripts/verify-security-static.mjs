import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  sortStaticSecurityFindings,
  STATIC_SECURITY_LIMITS,
  verifyGeneratedSourceSecurity,
  verifyIacSourceSecurity,
  verifyWorkflowSecurity,
} from "./security/static-verifier-core.mjs";

const readRegularText = async (path, label) => {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return readFile(path, "utf8");
};

const findings = [];
let omittedFindings = 0;
const addFindings = (values) => {
  for (const value of values) {
    if (findings.length < STATIC_SECURITY_LIMITS.maximumReportedFindings) {
      findings.push(value);
    } else {
      omittedFindings += 1;
    }
  }
};

const distribution = JSON.parse(
  await readFile(resolve("package.json"), "utf8"),
);
const publicSource =
  distribution.cloudmarkupDistribution === "public-source-v1";
const workflowDirectory = resolve(".github", "workflows");
const workflowEntries = await readdir(workflowDirectory, {
  withFileTypes: true,
}).catch((error) => {
  if (publicSource && error?.code === "ENOENT") return [];
  throw error;
});
workflowEntries.sort((left, right) =>
  left.name.localeCompare(right.name, "en"),
);
const workflowNames = [];
for (const entry of workflowEntries) {
  if (!/\.ya?ml$/u.test(entry.name)) continue;
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error("Static security workflow inputs must be regular files.");
  }
  workflowNames.push(entry.name);
}
if (
  (!publicSource && workflowNames.length < 1) ||
  workflowNames.length > STATIC_SECURITY_LIMITS.maximumWorkflowFiles
) {
  throw new Error("Static security workflow file count is outside its limit.");
}
for (const name of workflowNames) {
  const path = `.github/workflows/${name}`;
  addFindings(
    verifyWorkflowSecurity(
      path,
      await readRegularText(resolve(path), "Workflow input"),
    ),
  );
}

const generatedWorkflowPath =
  "packages/architecture-cli/templates/cloudmarkup-validate.yml";
addFindings(
  verifyWorkflowSecurity(
    generatedWorkflowPath,
    await readRegularText(
      resolve(generatedWorkflowPath),
      "Generated workflow input",
    ),
  ),
);

const generatedSourceFiles = [];
let generatedSourceEntries = 0;
const collectGeneratedSourceFiles = async (
  directory,
  displayRoot,
  depth = 0,
) => {
  if (depth > 32) {
    throw new Error("Generated-source directory depth exceeds its limit.");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    generatedSourceEntries += 1;
    if (
      generatedSourceEntries > STATIC_SECURITY_LIMITS.maximumTraversalEntries
    ) {
      throw new Error("Generated-source entry count exceeds its limit.");
    }
    const absolutePath = resolve(directory, entry.name);
    const displayPath = `${displayRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectGeneratedSourceFiles(absolutePath, displayPath, depth + 1);
    } else if (
      entry.isFile() &&
      displayPath.includes("/application-source/") &&
      !displayPath.includes("/extensions/") &&
      /\.(?:[cm]?[jt]sx?)$/u.test(entry.name)
    ) {
      generatedSourceFiles.push({ absolutePath, displayPath });
      if (
        generatedSourceFiles.length >
        STATIC_SECURITY_LIMITS.maximumGeneratedSourceFiles
      ) {
        throw new Error("Generated-source file count exceeds its limit.");
      }
    } else if (!entry.isFile()) {
      throw new Error(
        "Generated-source roots cannot contain non-regular entries.",
      );
    }
  }
};
await collectGeneratedSourceFiles(
  resolve("testdata", "generation-goldens-v1", "goldens"),
  "testdata/generation-goldens-v1/goldens",
);
for (const { absolutePath, displayPath } of generatedSourceFiles) {
  addFindings(
    verifyGeneratedSourceSecurity(
      displayPath,
      await readRegularText(absolutePath, "Generated-source input"),
    ),
  );
}

const iacFiles = [];
let iacEntries = 0;
const collectIacFiles = async (directory, displayRoot, depth = 0) => {
  if (depth > 32)
    throw new Error("Static IaC directory depth exceeds its limit.");
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    iacEntries += 1;
    if (iacEntries > STATIC_SECURITY_LIMITS.maximumTraversalEntries) {
      throw new Error("Static IaC entry count exceeds its limit.");
    }
    const absolutePath = resolve(directory, entry.name);
    const displayPath = `${displayRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectIacFiles(absolutePath, displayPath, depth + 1);
    } else if (entry.isFile() && /\.tf(?:\.json)?$/u.test(entry.name)) {
      iacFiles.push({ absolutePath, displayPath });
      if (iacFiles.length > STATIC_SECURITY_LIMITS.maximumIacSourceFiles) {
        throw new Error("Static IaC file count exceeds its limit.");
      }
    } else if (!entry.isFile()) {
      throw new Error("Static IaC roots cannot contain non-regular entries.");
    }
  }
};
await collectIacFiles(
  resolve("packages", "architecture-cli", "src", "fixtures"),
  "packages/architecture-cli/src/fixtures",
);
await collectIacFiles(
  resolve("testdata", "generation-goldens-v1", "goldens"),
  "testdata/generation-goldens-v1/goldens",
);
for (const { absolutePath, displayPath } of iacFiles) {
  addFindings(
    verifyIacSourceSecurity(
      displayPath,
      await readRegularText(absolutePath, "Terraform input"),
    ),
  );
}

const sorted = sortStaticSecurityFindings(findings);
if (sorted.length > 0 || omittedFindings > 0) {
  const omitted =
    omittedFindings === 0
      ? ""
      : `\n${String(omittedFindings)} additional finding(s) omitted by the report limit.`;
  process.stderr.write(
    `Static security invariants failed:\n${sorted
      .map(({ code, detail, path }) => `${path}: ${code}: ${detail}`)
      .join("\n")}${omitted}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `security:static: verified ${String(workflowNames.length)} checked-in workflow file(s), 1 generated repository workflow template, ${String(generatedSourceFiles.length)} generated-owned source golden(s), and ${String(iacFiles.length)} Terraform file(s) without network or credentials${publicSource ? " (public source profile; private deployment workflows absent)" : ""}.\n`,
  );
}
