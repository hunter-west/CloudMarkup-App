import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { RepositoryImportService } from "@cloudmarkup/repository-importer";

import type { GitHubRepositoryImportRunner } from "./repository-import.js";
import { gitHubRepositoryImportPathSchema } from "./repository-import-security.js";
import { GitHubExportError } from "./errors.js";

export function createMaterializedRepositoryImportRunner(
  importer: RepositoryImportService,
): GitHubRepositoryImportRunner {
  return Object.freeze({
    async importPinnedSnapshot(
      input: Parameters<
        GitHubRepositoryImportRunner["importPinnedSnapshot"]
      >[0],
    ) {
      const root = await mkdtemp(join(tmpdir(), "cloudmarkup-github-import-"));
      const resolvedRoot = resolve(root);
      try {
        if (!resolvedRoot.startsWith(resolve(tmpdir()) + sep)) {
          await rm(resolvedRoot, { force: true, recursive: true });
          throw new GitHubExportError("service-unavailable");
        }
        for (const file of input.files) {
          const path = gitHubRepositoryImportPathSchema.parse(file.path);
          if (path === ".") throw new GitHubExportError("import-blocked");
          const destination = resolve(root, ...path.split("/"));
          if (!destination.startsWith(`${resolvedRoot}${sep}`)) {
            throw new GitHubExportError("import-blocked");
          }
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, file.bytes, { flag: "wx", mode: 0o600 });
        }
        return await importer.importRepository({
          request: input.request,
          sourceDirectory: resolvedRoot,
        });
      } finally {
        await rm(resolvedRoot, { force: true, recursive: true });
      }
    },
  });
}
