import assert from "node:assert/strict";
import test from "node:test";

import { normalizeImportedProviderSvgSource } from "./source-normalization.mjs";
import { REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP } from "./transformation-steps.mjs";
import {
  MAX_PROVIDER_SVG_BYTES,
  validateAndNormalizeSvg,
} from "./svg-policy.mjs";

const declaration = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
const svgNamespace = ' xmlns="http://www.w3.org/2000/svg"';

function assertUnchangedAndRejected(source, expected = /namespace-prefixed/u) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const result = normalizeImportedProviderSvgSource(bytes);

  assert.equal(result.removedUnusedRootXlinkNamespaceDeclaration, false);
  assert.deepEqual(result.bytes, bytes);
  assert.throws(() => validateAndNormalizeSvg(result.bytes), expected);
}

test("removes exactly one parser-proven unused root XLink declaration", () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>\r\n<svg data-note="resource"${svgNamespace}${declaration} viewBox="0 0 48 48">\r\n  <title>AWS resource</title>\r\n  <g fill="#123456"><path d="M2 2h44v44H2z"/></g>\r\n</svg>`;
  const expected = source.replace(declaration, "");

  const first = normalizeImportedProviderSvgSource(Buffer.from(source));
  const second = normalizeImportedProviderSvgSource(Buffer.from(source));

  assert.equal(
    REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP,
    "remove-unused-root-xlink-namespace-v1",
  );
  assert.equal(first.removedUnusedRootXlinkNamespaceDeclaration, true);
  assert.deepEqual(first.bytes, Buffer.from(expected));
  assert.deepEqual(second, first);
  assert.doesNotThrow(() => validateAndNormalizeSvg(first.bytes));
  assert.throws(
    () => validateAndNormalizeSvg(Buffer.from(source)),
    /namespace-prefixed/u,
    "the admitted-byte validator must keep rejecting the original declaration",
  );
});

test("finds the root declaration after a quoted greater-than character", () => {
  const source = `<svg data-note=">"${svgNamespace}${declaration} viewBox="0 0 1 1"><path d="M0 0"/></svg>`;
  const result = normalizeImportedProviderSvgSource(Buffer.from(source));

  assert.equal(result.removedUnusedRootXlinkNamespaceDeclaration, true);
  assert.deepEqual(result.bytes, Buffer.from(source.replace(declaration, "")));
  assert.throws(() => validateAndNormalizeSvg(result.bytes), /viewBox/u);
});

test("preserves a BOM, attribute order, and all bytes outside the declaration", () => {
  const source = `\uFEFF<svg${svgNamespace} data-before="alpha"${declaration} data-after="omega" viewBox="0 0 1 1"><path d="M0 0"/></svg>`;
  const result = normalizeImportedProviderSvgSource(Buffer.from(source));

  assert.equal(result.removedUnusedRootXlinkNamespaceDeclaration, true);
  assert.deepEqual(result.bytes, Buffer.from(source.replace(declaration, "")));
});

test("does not claim the source transformation for an already safe SVG", () => {
  const source = `<svg${svgNamespace} viewBox="0 0 1 1"><path d="M0 0"/></svg>`;
  const bytes = Buffer.from(source);
  const result = normalizeImportedProviderSvgSource(bytes);

  assert.equal(result.removedUnusedRootXlinkNamespaceDeclaration, false);
  assert.deepEqual(result.bytes, bytes);
  assert.doesNotThrow(() => validateAndNormalizeSvg(result.bytes));
  assert.equal(Object.isFrozen(result), true);
});

test("leaves used XLink, aliases, prefixes, and namespace rebounds rejected", () => {
  for (const source of [
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><defs><path id="shape" d="M0 0"/></defs><use xlink:href="#shape"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><use xlink:href="https://example.invalid/shape"/></svg>`,
    `<svg${svgNamespace}${declaration} xlink:title="resource" viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><xlink:g/></svg>`,
    `<svg${svgNamespace}${declaration} xmlns:alternate="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><path alternate:href="#shape" d="M0 0"/></svg>`,
    `<svg${svgNamespace} xmlns:alternate="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} xml:base="https://example.invalid/" viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><g xmlns="http://www.w3.org/1999/xlink"><path d="M0 0"/></g></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><g xmlns:xlink="http://example.invalid/rebound"><path d="M0 0"/></g></svg>`,
  ]) {
    assertUnchangedAndRejected(source);
  }
});

test("requires the exact reviewed root declaration lexeme", () => {
  for (const variant of [
    " xmlns:xlink='http://www.w3.org/1999/xlink'",
    ' xmlns:xlink = "http://www.w3.org/1999/xlink"',
    ' xmlns:xlink="http://www.w3.org/1999/xlink/"',
    ' xmlns:xlink="HTTP://www.w3.org/1999/xlink"',
    ' xmlns:xl="http://www.w3.org/1999/xlink"',
  ]) {
    assertUnchangedAndRejected(
      `<svg${svgNamespace}${variant} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    );
  }

  assertUnchangedAndRejected(
    `<svg${svgNamespace} viewBox="0 0 1 1"><g${declaration}><path d="M0 0"/></g></svg>`,
  );
  assertUnchangedAndRejected(
    `<s:svg xmlns:s="http://www.w3.org/2000/svg"${declaration} viewBox="0 0 1 1"><s:path d="M0 0"/></s:svg>`,
  );
  assertUnchangedAndRejected(
    `<svg${svgNamespace}${declaration}${declaration} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
  );
});

test("refuses declaration-like text that could deceive string replacement", () => {
  for (const source of [
    `<!--${declaration}--><svg${svgNamespace} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<!--<svg${svgNamespace}${declaration}>--><svg${svgNamespace} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace} viewBox="0 0 1 1"><text><![CDATA[${declaration}]]></text></svg>`,
    `<svg${svgNamespace} viewBox="0 0 1 1"><title>${declaration}</title></svg>`,
    `<svg${svgNamespace} data-note='${declaration}' viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><!--${declaration}--><path d="M0 0"/></svg>`,
    `<svg${svgNamespace} xmlns:xlink='http://www.w3.org/1999/xlink' data-note='${declaration}' viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
  ]) {
    assertUnchangedAndRejected(source);
  }
});

test("runs the unchanged active-content validator after safe removal", () => {
  const source = `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><script>alert(1)</script></svg>`;
  const result = normalizeImportedProviderSvgSource(Buffer.from(source));

  assert.equal(result.removedUnusedRootXlinkNamespaceDeclaration, true);
  assert.throws(
    () => validateAndNormalizeSvg(result.bytes),
    /executable, embedded, or unbounded-complexity/u,
  );
});

test("preflights untrusted source before structural normalization", () => {
  const dangerousSources = [
    [
      `<!DOCTYPE svg><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /DTD/u,
    ],
    [
      `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><text>&amp;</text></svg>`,
      /character and entity references/u,
    ],
    [
      `<?editor value?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<?xml-stylesheet href="https://example.invalid/x.css"?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<?xml-foo?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<?xml:foo?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<?XML version="1.0"?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<?xml encoding="UTF-8"?><svg${svgNamespace}${declaration} viewBox="0 0 1 1"></svg>`,
      /processing-instruction/u,
    ],
    [
      `<svg${svgNamespace}${declaration} xmlns:xi="http://www.w3.org/2001/XInclude" viewBox="0 0 1 1"><xi:include href="local.svg"/></svg>`,
      /inclusion/u,
    ],
    [
      `<svg${svgNamespace}${declaration} data-note="\\" viewBox="0 0 1 1"></svg>`,
      /backslash escapes/u,
    ],
    [Buffer.from([0xff]), /valid UTF-8/u],
    [
      Buffer.from(
        `<svg${svgNamespace}${declaration}\0 viewBox="0 0 1 1"></svg>`,
      ),
      /NUL/u,
    ],
  ];

  for (const [source, expected] of dangerousSources) {
    assertUnchangedAndRejected(source, expected);
  }
});

test("does not make an oversized original eligible by removing bytes", () => {
  const prefix = `<svg${svgNamespace}${declaration} viewBox="0 0 1 1" data-padding="`;
  const suffix = '"><path d="M0 0"/></svg>';
  const padding = "a".repeat(
    MAX_PROVIDER_SVG_BYTES +
      1 -
      Buffer.byteLength(prefix) -
      Buffer.byteLength(suffix),
  );
  const bytes = Buffer.from(`${prefix}${padding}${suffix}`);

  assert.equal(bytes.byteLength, MAX_PROVIDER_SVG_BYTES + 1);
  assertUnchangedAndRejected(bytes, /exceeds/u);
});
