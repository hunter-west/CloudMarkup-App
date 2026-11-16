import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkDocumentBrand,
  transformMarkdown,
} from "./check-document-brand.mjs";

test("brand prose changes preserve Markdown structure and literal identities", async () => {
  const literal = [
    "[name](https://github.com/hunter-west/CloudMarkup-App)",
    "[CloudMarkup][CloudMarkup] and [CloudMarkup][] and [CloudMarkup]",
    '[CloudMarkup]: /CloudMarkup-App "CloudMarkup title"',
    "<https://example.test/CloudMarkup?brand=CloudMarkup>",
    "https://example.test/?brand=CloudMarkup",
    "`CloudMarkup` and ``CloudMarkup `literal` ``",
    "    CloudMarkup indented code",
    "````text\nCloudMarkup\n```\nCloudCanvas\n````",
    '<span id="CloudMarkup">literal</span>',
    "CloudMarkup-App MyCloudMarkupType CloudMarkup.value CloudMarkup() @CloudMarkup",
    "![CloudMarkup](./CloudMarkup.png)",
    '[label](<../CloudMarkup file.md> "CloudMarkup")',
  ].join("\n\n");
  const prose =
    "# CloudMarkup\n\nCloudCanvas and CloudMarkup.\n\n[CloudMarkup docs](./CloudMarkup-App)\n\n";
  const result = await transformMarkdown(prose + literal);
  assert.equal(
    result.source,
    prose
      .replaceAll("# CloudMarkup", "# Cloud Markup")
      .replace("CloudCanvas and CloudMarkup.", "Cloud Markup and Cloud Markup.")
      .replace("[CloudMarkup docs]", "[Cloud Markup docs]") + literal,
  );
  assert.deepEqual(result.findings, [1, 3, 5]);
  assert.deepEqual(await transformMarkdown(result.source), {
    findings: [],
    source: result.source,
  });
  assert.deepEqual(await transformMarkdown(prose + literal, true), {
    findings: [],
    source: prose + literal,
  });
});

test("brand diagnostics and explicit writes use intact relative paths on synthetic files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-brand-"));
  try {
    const original =
      "CloudMarkup prose\n\nhttps://github.com/hunter-west/CloudMarkup-App\n";
    await writeFile(join(root, "README.md"), original);
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    const history =
      "- Status: Accepted\n\nCloudCanvas was renamed CloudMarkup.\n";
    const historyPath = join(root, "docs", "adr", "0001-record.md");
    await writeFile(historyPath, history);
    assert.deepEqual(await checkDocumentBrand(root), {
      changed: 0,
      files: 2,
      unresolved: ["README.md:1"],
    });
    assert.equal(await readFile(join(root, "README.md"), "utf8"), original);
    assert.deepEqual(await checkDocumentBrand(root, { write: true }), {
      changed: 1,
      files: 2,
      unresolved: [],
    });
    assert.equal(
      await readFile(join(root, "README.md"), "utf8"),
      original.replace("CloudMarkup prose", "Cloud Markup prose"),
    );
    assert.equal(await readFile(historyPath, "utf8"), history);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
