import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(process.cwd());
const targets = [
  ["web-production", "apps/web/dist"],
  ["api-lambda-build", "apps/api/dist"],
  ["application-generator-runtime", "packages/application-generator/dist"],
  [
    "application-build-runner-runtime",
    "packages/application-build-runner/dist",
  ],
  ["architecture-cli-runtime", "packages/architecture-cli/dist"],
  ["diagram-export-runtime", "packages/diagram-export/dist"],
];

async function inventory(relativeRoot) {
  const absoluteRoot = path.resolve(repositoryRoot, relativeRoot);
  if (!absoluteRoot.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("A beta size target resolved outside the repository.");
  }
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Build size inventory does not follow symbolic link ${absolutePath}.`,
        );
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        files.push({
          bytes: metadata.size,
          path: path
            .relative(repositoryRoot, absolutePath)
            .split(path.sep)
            .join("/"),
        });
      }
    }
  }
  await walk(absoluteRoot);
  if (files.length === 0) {
    throw new Error(`Build size target ${relativeRoot} contains no files.`);
  }
  return {
    fileCount: files.length,
    largestFiles: [...files]
      .sort(
        (left, right) =>
          right.bytes - left.bytes || left.path.localeCompare(right.path, "en"),
      )
      .slice(0, 5),
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

const measurements = [];
for (const [id, root] of targets) {
  measurements.push({ id, root, ...(await inventory(root)) });
}
console.info(
  JSON.stringify(
    {
      kind: "cloudmarkup.beta-artifact-size-baseline",
      node: process.version,
      targets: measurements,
      version: 1,
    },
    undefined,
    2,
  ),
);
