import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import {
  archiveBetaImageContexts,
  digestBetaImageContexts,
  formatBetaImageContextDigests,
  validateBetaImageContexts,
} from "./beta-image-contexts-core.mjs";

const CANDIDATE_WARNING =
  "WARNING: These are candidate context digests only. Codex has not independently approved them. Hunter or a separate reviewer must recompute them at the exact reviewed main revision.";

function usage() {
  return [
    "Usage:",
    "  node scripts/beta-image-contexts.mjs check",
    "  node scripts/beta-image-contexts.mjs digest",
    "  node scripts/beta-image-contexts.mjs archive <empty-bundle-dir> [empty-tar-derived-build-root]",
    "  node scripts/beta-image-contexts.mjs archive-application <empty-bundle-dir> <empty-tar-derived-build-root> [--go-cache <cache-dir>]",
    "",
  ].join("\n");
}

export async function runBetaImageContextsCli(
  arguments_,
  {
    fetchImpl = globalThis.fetch,
    repositoryRoot = resolve("."),
    stderr = process.stderr,
    stdout = process.stdout,
  } = {},
) {
  const [command, ...operands] = arguments_;
  if (command === "check" && operands.length === 0) {
    const contexts = await validateBetaImageContexts(repositoryRoot, {
      allowMissingAcquired: true,
    });
    stdout.write(
      `beta:image-contexts:check: ${String(contexts.length)} declared contexts valid; generated artifacts were not fetched.\n`,
    );
    return;
  }
  if (command === "digest" && operands.length === 0) {
    const result = await digestBetaImageContexts(repositoryRoot, { fetchImpl });
    stdout.write(formatBetaImageContextDigests(result));
    stderr.write(`${CANDIDATE_WARNING}\n`);
    return;
  }
  if (
    (command === "archive" &&
      (operands.length === 1 || operands.length === 2)) ||
    (command === "archive-application" &&
      (operands.length === 2 ||
        (operands.length === 4 && operands[2] === "--go-cache")))
  ) {
    const contextIds =
      command === "archive-application" ? ["application-build"] : undefined;
    const result = await archiveBetaImageContexts(
      resolve(operands[0]),
      repositoryRoot,
      {
        contextIds,
        fetchImpl,
        ...(operands[3] === undefined
          ? {}
          : { goToolCacheRoot: resolve(operands[3]) }),
        ...(operands[1] === undefined
          ? {}
          : { resolvedOutputDirectory: resolve(operands[1]) }),
      },
    );
    stdout.write(formatBetaImageContextDigests(result, contextIds));
    stderr.write(`${CANDIDATE_WARNING}\n`);
    return;
  }
  throw new Error(usage());
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(resolve(entry)).href
) {
  try {
    await runBetaImageContextsCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Image-context command failed."}\n`,
    );
    process.exitCode = 1;
  }
}

export { CANDIDATE_WARNING };
