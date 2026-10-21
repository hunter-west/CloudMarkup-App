import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  parseArchitectureDocumentV1Json,
  parseArchitectureDocumentV2Json,
  parseIntentDocumentV1Json,
  serializeArchitectureDocumentV1,
  serializeArchitectureDocumentV2,
  serializeIntentDocumentV1,
} from "./index.js";

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("canonical document fixture snapshots", () => {
  it("keeps the Architecture Document snapshot byte-stable across runs", async () => {
    const source = await readRepositoryFile(
      "packages/test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
    );
    const expected = await readRepositoryFile(
      "packages/test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v1.canonical.json",
    );
    const document = parseArchitectureDocumentV1Json(source);
    const serializations = Array.from({ length: 8 }, () =>
      serializeArchitectureDocumentV1(document),
    );

    expect(new Set(serializations)).toEqual(new Set([expected]));
  });

  it("keeps the Architecture Document v2 snapshot byte-stable across runs", async () => {
    const source = await readRepositoryFile(
      "packages/test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
    );
    const expected = await readRepositoryFile(
      "packages/test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v2.canonical.json",
    );
    const document = parseArchitectureDocumentV2Json(source);
    const serializations = Array.from({ length: 8 }, () =>
      serializeArchitectureDocumentV2(document),
    );

    expect(new Set(serializations)).toEqual(new Set([expected]));
  });

  it("keeps the Intent Document snapshot byte-stable across runs", async () => {
    const source = await readRepositoryFile(
      "packages/test-fixtures/fixtures/intent-document/v1/valid/representative.json",
    );
    const expected = await readRepositoryFile(
      "packages/test-fixtures/fixtures/document-versioning/snapshots/intent-document-v1.canonical.json",
    );
    const document = parseIntentDocumentV1Json(source);
    const serializations = Array.from({ length: 8 }, () =>
      serializeIntentDocumentV1(document),
    );

    expect(new Set(serializations)).toEqual(new Set([expected]));
  });
});
