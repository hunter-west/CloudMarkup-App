import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const moduleDirectory = resolve("services", "iac-compiler");

async function findGoFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findGoFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".go")) {
      files.push(entryPath);
    }
  }

  return files;
}

const goFiles = await findGoFiles(moduleDirectory);

if (goFiles.length === 0) {
  throw new Error("No Go source files were found in the IaC compiler module.");
}

const result = spawnSync("gofmt", ["-l", ...goFiles], {
  encoding: "utf8",
});

if (result.error !== undefined) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
} else {
  const unformattedFiles = result.stdout.trim();

  if (unformattedFiles.length > 0) {
    process.stderr.write(
      `Go files require formatting:\n${unformattedFiles}\nRun pnpm go:format.\n`,
    );
    process.exitCode = 1;
  } else {
    console.log("go:format:check: all Go files are formatted.");
  }
}
