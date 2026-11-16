import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsers } from "prettier/plugins/markdown";
import { markdownFiles } from "./markdown-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const literalNodes = new Set([
  "code",
  "inlineCode",
  "html",
  "definition",
  "linkReference",
  "imageReference",
  "image",
  "yaml",
  "toml",
  "math",
  "inlineMath",
]);

export async function transformMarkdown(
  source,
  preserveHistoricalName = false,
) {
  if (preserveHistoricalName) return { findings: [], source };
  const tree = await parsers.markdown.parse(source);
  const edits = [];
  const findings = new Set();
  const visit = (node) => {
    if (literalNodes.has(node.type)) return;
    // Autolinks display their destination as text. Ordinary link labels may
    // change, but their destination/title never become edit ranges.
    if (node.type === "link" && source[node.position.start.offset] !== "[")
      return;
    if (node.type === "text") {
      const start = node.position.start.offset;
      const text = source.slice(start, node.position.end.offset);
      const urls = [
        ...text.matchAll(
          /(?:\b[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)[^\s<>]+/giu,
        ),
      ];
      for (const match of text.matchAll(/CloudMarkup|CloudCanvas/gu)) {
        const offset = match.index;
        const before = text[offset - 1] ?? "";
        const after = text[offset + match[0].length] ?? "";
        const following = text[offset + match[0].length + 1] ?? "";
        if (
          /[\p{L}\p{N}_./:@%+[\]-]/u.test(before) ||
          /[\p{L}\p{N}_/@%+([\]-]/u.test(after) ||
          (after === "." && /[\p{L}\p{N}_]/u.test(following)) ||
          urls.some(
            (url) => offset >= url.index && offset < url.index + url[0].length,
          )
        )
          continue;
        edits.push({
          start: start + offset,
          end: start + offset + match[0].length,
        });
        findings.add(source.slice(0, start + offset).split("\n").length);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  let transformed = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, edit.start) +
      "Cloud Markup" +
      transformed.slice(edit.end);
  }
  return {
    findings: [...findings].sort((left, right) => left - right),
    source: transformed,
  };
}

export async function checkDocumentBrand(root, { write = false } = {}) {
  const files = (await markdownFiles(root)).sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  const unresolved = [];
  let changed = 0;
  for (const path of files) {
    const source = await readFile(path, "utf8");
    const relativePath = relative(root, path).replaceAll("\\", "/");
    const preserveHistoricalName =
      /^docs\/adr\/(?:00(?:0[1-9]|1[0-9]|2[0-8]))-/u.test(relativePath) &&
      /^- (?:\*\*Status:\*\*|Status:) (?:Accepted|Superseded)$/mu.test(source);
    const result = await transformMarkdown(source, preserveHistoricalName);
    if (result.findings.length === 0) continue;
    if (write) {
      await writeFile(path, result.source, "utf8");
      changed += 1;
    } else {
      for (const line of result.findings)
        unresolved.push(`${relativePath}:${String(line)}`);
    }
  }
  return { changed, files: files.length, unresolved };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const write = process.argv.slice(2).includes("--write");
  const result = await checkDocumentBrand(repositoryRoot, { write });
  if (result.unresolved.length > 0) {
    process.stderr.write(
      `Retired human-facing product names remain:\n${result.unresolved.join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      write
        ? `Updated ${String(result.changed)} Markdown files to the Cloud Markup display name.\n`
        : `Checked ${String(result.files)} Markdown files; Cloud Markup display naming is current.\n`,
    );
  }
}
