import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { markdownFiles } from "./markdown-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const markdownLink = /\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/gu;

function localTarget(raw) {
  const target =
    raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  if (
    target.startsWith("#") ||
    /^(?:https?:|mailto:|tel:)/iu.test(target) ||
    target.includes("${")
  ) {
    return null;
  }
  const withoutFragment = target.split("#", 1)[0] ?? "";
  return withoutFragment.length === 0
    ? null
    : decodeURIComponent(withoutFragment);
}

const failures = [];
const files = (await markdownFiles(repositoryRoot)).sort((left, right) =>
  left.localeCompare(right, "en-US"),
);
for (const path of files) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(markdownLink)) {
    const target = localTarget(match[1] ?? "");
    if (target === null) continue;
    const resolved = target.startsWith("/")
      ? resolve(repositoryRoot, `.${target}`)
      : resolve(dirname(path), target);
    try {
      await access(resolved);
    } catch {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(
        `${path.slice(repositoryRoot.length + 1)}:${String(line)} -> ${target}`,
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Broken local Markdown links:\n${failures.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked local links in ${String(files.length)} Markdown files.\n`,
  );
}
