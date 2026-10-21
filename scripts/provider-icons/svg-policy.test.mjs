import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROVIDER_SVG_BYTES,
  validateAndNormalizeSvg,
} from "./svg-policy.mjs";

test("accepts bounded path and geometry syntax used by static provider icons", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="24px"><path d="M2 2h20v20H2z"/><polyline points="2,2 12,20 22,2"/></svg>';
  const result = validateAndNormalizeSvg(Buffer.from(source));

  assert.equal(result.elementCount, 3);
  assert.equal(result.pathCommandCount, 5);
  assert.equal(result.viewBox, "0 0 24 24");
});

test("accepts only a grammatical lowercase XML declaration", () => {
  const body =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>';

  for (const declaration of [
    '<?xml version="1.0"?>',
    "<?xml version='1.1' encoding='uTf-8' standalone='yes'?>",
  ]) {
    assert.doesNotThrow(() =>
      validateAndNormalizeSvg(Buffer.from(`${declaration}${body}`)),
    );
  }

  for (const instruction of [
    '<?xml-stylesheet href="https://example.invalid/x.css"?>',
    "<?xml-foo?>",
    "<?xml:foo?>",
    '<?XML version="1.0"?>',
    "<?xml?>",
    '<?xml encoding="UTF-8"?>',
    '<?xml version="1.0" unexpected="value"?>',
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<?xml version="1.2"?>',
    '<?xml version="1.01"?>',
  ]) {
    assert.throws(
      () => validateAndNormalizeSvg(Buffer.from(`${instruction}${body}`)),
      /processing-instruction/u,
      instruction,
    );
  }
});

test("rejects non-finite, extreme, and malformed path coordinates", () => {
  for (const [pathData, expected] of [
    ["M1e999 0L1 1", /bounded finite numeric values/u],
    ["M10000001 0L1 1", /bounded finite numeric values/u],
    ["M0 0LNaN 1", /invalid numeric syntax/u],
    ["M0 0L1", /invalid parameter count/u],
    ["L0 0", /begin with a move command/u],
    ["M0 0A1 1 0 2 0 4 4", /arc flags/u],
  ]) {
    assert.throws(
      () =>
        validateAndNormalizeSvg(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${pathData}"/></svg>`,
          ),
        ),
      expected,
      pathData,
    );
  }
});

test("rejects non-finite and extreme geometry attributes and points", () => {
  for (const [shape, expected] of [
    [
      '<rect x="1e999" width="1" height="1"/>',
      /bounded finite numeric values/u,
    ],
    ['<circle cx="10000001" cy="1" r="1"/>', /bounded finite numeric values/u],
    ['<rect x="0" width="-1" height="1"/>', /width cannot be negative/u],
    ['<polyline points="0,0 1"/>', /coordinate pairs/u],
    ['<path d="M0 0" stroke-width="1e999"/>', /bounded finite numeric values/u],
    ['<text font-size="1e999">label</text>', /bounded finite numeric values/u],
    ['<rect width="10000000%" height="1"/>', /bounded finite numeric values/u],
    [
      '<rect width="10000000in" height="1"/>',
      /finite unitless, px, or percentage length/u,
    ],
    [
      '<symbol id="symbol" viewBox="0 0 1e999 1"><path d="M0 0"/></symbol>',
      /bounded finite numeric values/u,
    ],
    ['<text dx="1e999">label</text>', /bounded finite numeric values/u],
    [
      '<defs><linearGradient id="gradient" gradientTransform="scale(1e999)"/></defs>',
      /transforms exceed the bounded numeric range/u,
    ],
  ]) {
    assert.throws(
      () =>
        validateAndNormalizeSvg(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${shape}</svg>`,
          ),
        ),
      expected,
    );
  }
});

test("rejects recursive local resource references beyond use elements", () => {
  for (const shape of [
    '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
    '<defs><clipPath id="a"><rect width="1" height="1" clip-path="url(#a)"/></clipPath></defs>',
  ]) {
    assert.throws(
      () =>
        validateAndNormalizeSvg(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${shape}</svg>`,
          ),
        ),
      /local fragment references cannot be recursive/u,
    );
  }
});

test("rechecks the admitted byte limit after normalization", () => {
  const prefix =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" data-padding="';
  const suffix = '"></svg>';
  const paddingBytes =
    MAX_PROVIDER_SVG_BYTES -
    Buffer.byteLength(prefix) -
    Buffer.byteLength(suffix);
  const exactLimitSource = `${prefix}${"a".repeat(paddingBytes)}${suffix}`;

  assert.equal(Buffer.byteLength(exactLimitSource), MAX_PROVIDER_SVG_BYTES);
  assert.throws(
    () => validateAndNormalizeSvg(Buffer.from(exactLimitSource)),
    /normalized file exceeds/u,
  );
});
