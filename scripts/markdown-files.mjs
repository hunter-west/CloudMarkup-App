import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

const ignoredDirectories = new Set([
  ".cache",
  ".git",
  ".turbo",
  "cdk.out",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);

export async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(path);
    }
  }
  return files;
}
