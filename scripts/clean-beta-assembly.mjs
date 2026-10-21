import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const betaAssemblySegments = ["artifacts", "platform", "cdk.out"];
const scriptPath = fileURLToPath(import.meta.url);
export const repositoryRoot = resolve(dirname(scriptPath), "..");

async function optionalMetadata(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(".." + sep) &&
    !isAbsolute(pathFromParent)
  );
}

async function assertDirectoryWithoutLinks(
  path,
  label,
  { optional = false } = {},
) {
  const metadata = await optionalMetadata(path);
  if (metadata === undefined && optional) return false;
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    throw new Error(label + " must be a real directory, not a link.");
  }
  return true;
}

export async function cleanBetaAssembly(root = repositoryRoot) {
  const absoluteRoot = resolve(root);
  await assertDirectoryWithoutLinks(absoluteRoot, "The repository root");

  const packagePath = join(absoluteRoot, "package.json");
  const packageMetadata = await optionalMetadata(packagePath);
  if (
    packageMetadata === undefined ||
    !packageMetadata.isFile() ||
    packageMetadata.isSymbolicLink()
  ) {
    throw new Error(
      "The repository root must contain a real package.json file.",
    );
  }
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (
    packageManifest.name !== "cloudmarkup" ||
    packageManifest.private !== true
  ) {
    throw new Error(
      "Refusing to clean outside the private cloudmarkup repository.",
    );
  }

  const canonicalRoot = await realpath(absoluteRoot);
  let currentPath = absoluteRoot;
  for (const [index, segment] of betaAssemblySegments.entries()) {
    currentPath = join(currentPath, segment);
    const exists = await assertDirectoryWithoutLinks(
      currentPath,
      "The beta assembly path segment " + segment,
      { optional: true },
    );
    if (!exists) return { removed: false, target: currentPath };

    const canonicalPath = await realpath(currentPath);
    if (!isWithin(canonicalRoot, canonicalPath)) {
      throw new Error(
        "The beta assembly path must remain inside the repository.",
      );
    }

    if (index === betaAssemblySegments.length - 1) {
      await rm(currentPath, { recursive: true });
      return { removed: true, target: currentPath };
    }
  }

  throw new Error("The beta assembly path could not be resolved safely.");
}

async function main() {
  const result = await cleanBetaAssembly();
  process.stdout.write(
    result.removed
      ? "beta:clean-assembly: removed the admitted preflight cloud assembly.\n"
      : "beta:clean-assembly: no preflight cloud assembly was present.\n",
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPoint)).href
) {
  await main();
}
