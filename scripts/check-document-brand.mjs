import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { markdownFiles } from "./markdown-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const write = process.argv.slice(2).includes("--write");
const formerProductName = /CloudCanvas/gu;
const retiredDisplayName = /CloudMarkup/gu;

function replaceProse(segment, preserveHistoricalName) {
  const currentDisplayName = segment.replaceAll(
    retiredDisplayName,
    "Cloud Markup",
  );
  return preserveHistoricalName
    ? currentDisplayName
    : currentDisplayName.replaceAll(formerProductName, "Cloud Markup");
}

function processInlineCode(line, replace) {
  let cursor = 0;
  let output = "";
  while (cursor < line.length) {
    const opening = line.indexOf("`", cursor);
    if (opening === -1) return output + replace(line.slice(cursor));
    output += replace(line.slice(cursor, opening));
    let endOfRun = opening;
    while (line[endOfRun] === "`") endOfRun += 1;
    const delimiter = line.slice(opening, endOfRun);
    const closing = line.indexOf(delimiter, endOfRun);
    if (closing === -1) return output + line.slice(opening);
    output += line.slice(opening, closing + delimiter.length);
    cursor = closing + delimiter.length;
  }
  return output;
}

function transformMarkdown(source, preserveHistoricalName) {
  let fence = null;
  const lines = source.split(/(?<=\n)/u);
  const findings = [];
  const transformed = lines.map((line, index) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]?.[0] ?? null;
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      return line;
    }
    if (fence !== null) return line;
    const replaced = processInlineCode(line, (segment) =>
      replaceProse(segment, preserveHistoricalName),
    );
    if (replaced !== line) findings.push(index + 1);
    return replaced;
  });
  return { findings, source: transformed.join("") };
}

const files = (await markdownFiles(repositoryRoot)).sort((left, right) =>
  left === right ? 0 : left < right ? -1 : 1,
);
const unresolved = [];
let changed = 0;
for (const path of files) {
  const source = await readFile(path, "utf8");
  const relativePath = relative(repositoryRoot, path).replaceAll("\\", "/");
  const preserveHistoricalName =
    /^docs\/adr\/(?:00(?:0[1-9]|1[0-9]|2[0-8]))-/u.test(relativePath) &&
    /^- (?:\*\*Status:\*\*|Status:) (?:Accepted|Superseded)$/mu.test(source);
  const result = transformMarkdown(source, preserveHistoricalName);
  if (result.findings.length === 0) continue;
  if (write) {
    await writeFile(path, result.source, "utf8");
    changed += 1;
  } else {
    for (const line of result.findings) {
      unresolved.push(
        `${path.slice(repositoryRoot.length + 1)}:${String(line)}`,
      );
    }
  }
}

if (unresolved.length > 0) {
  process.stderr.write(
    `Retired human-facing product names remain:\n${unresolved.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    write
      ? `Updated ${String(changed)} Markdown files to the Cloud Markup display name.\n`
      : `Checked ${String(files.length)} Markdown files; Cloud Markup display naming is current.\n`,
  );
}
