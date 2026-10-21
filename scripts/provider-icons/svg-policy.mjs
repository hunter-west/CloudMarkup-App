import { TextDecoder } from "node:util";

import { SaxesParser } from "saxes";
import { stripInitialXmlDeclaration } from "./xml-source.mjs";

export const MAX_PROVIDER_SVG_BYTES = 256 * 1024;
export const MAX_PROVIDER_SVG_ELEMENTS = 2_000;
export const MAX_PROVIDER_SVG_PATH_COMMANDS = 20_000;
export const MAX_PROVIDER_SVG_COORDINATE_MAGNITUDE = 10_000_000;
export const MAX_PROVIDER_SVG_PERCENT_MAGNITUDE = 1_000;

const SAFE_XML_NAMESPACE = "http://www.w3.org/2000/svg";
const FORBIDDEN_ELEMENT_PATTERN =
  /<(?:script|style|foreignObject|animate[\w.-]*|set|discard|iframe|object|embed|audio|video|image|filter|mask|pattern)\b/iu;
const EVENT_HANDLER_PATTERN = /\son[a-z][\w:.-]*\s*=/iu;
const NAMESPACE_PREFIXED_ELEMENT_PATTERN =
  /<\/?\s*[\p{L}_][\p{L}\p{N}_.-]*:[\p{L}_][\p{L}\p{N}_.:-]*\b/iu;
const NAMESPACE_PREFIXED_ATTRIBUTE_PATTERN =
  /\s[\p{L}_][\p{L}\p{N}_.-]*:[\p{L}_][\p{L}\p{N}_.:-]*\s*=/iu;
const STYLE_ATTRIBUTE_PATTERN = /\sstyle\s*=/iu;
const URL_SCHEME_PATTERN =
  /(?:https?:|ftp:|file:|data:|blob:|javascript:|vbscript:|\/\/)/iu;
const PATH_COMMAND_PATTERN = /^[AaCcHhLlMmQqSsTtVvZz]$/u;
const NUMBER_SOURCE = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const NUMBER_AT_POSITION_PATTERN = new RegExp(NUMBER_SOURCE, "y");
const LENGTH_PATTERN = new RegExp(`^(${NUMBER_SOURCE})(%|px)?$`, "u");
const LENGTH_LIST_ATTRIBUTES = new Set(["dx", "dy", "stroke-dasharray"]);
const UNIT_INTERVAL_ATTRIBUTES = new Set([
  "fill-opacity",
  "opacity",
  "stop-opacity",
  "stroke-opacity",
]);
const PATH_PARAMETER_COUNTS = Object.freeze({
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
});
const GEOMETRY_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "font-size",
  "fr",
  "fx",
  "fy",
  "height",
  "letter-spacing",
  "markerHeight",
  "markerWidth",
  "offset",
  "pathLength",
  "r",
  "refX",
  "refY",
  "rx",
  "ry",
  "startOffset",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-width",
  "textLength",
  "width",
  "word-spacing",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);
const NONNEGATIVE_GEOMETRY_ATTRIBUTES = new Set([
  "font-size",
  "fr",
  "height",
  "markerHeight",
  "markerWidth",
  "pathLength",
  "r",
  "rx",
  "ry",
  "stroke-miterlimit",
  "stroke-width",
  "textLength",
  "width",
]);

function fail(message) {
  throw new TypeError(`Unsafe provider SVG: ${message}`);
}

function readAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "iu"),
  );
  return match?.[2];
}

function tokenizeNumberOrPathSequence(value, allowCommands, label) {
  const tokens = [];
  let index = 0;
  let previousKind;
  while (index < value.length) {
    let hasSeparator = false;
    while (/[\t\n\r ]/u.test(value[index] ?? "")) {
      hasSeparator = true;
      index += 1;
    }
    if (index >= value.length) {
      break;
    }

    if (value[index] === ",") {
      if (previousKind !== "number") {
        fail(`${label} contains an invalid comma separator.`);
      }
      hasSeparator = true;
      index += 1;
      while (/[\t\n\r ]/u.test(value[index] ?? "")) {
        index += 1;
      }
      if (
        index >= value.length ||
        value[index] === "," ||
        PATH_COMMAND_PATTERN.test(value[index])
      ) {
        fail(`${label} contains an invalid comma separator.`);
      }
    }

    const character = value[index];
    if (PATH_COMMAND_PATTERN.test(character)) {
      if (!allowCommands) {
        fail(`${label} contains a path command.`);
      }
      tokens.push({ kind: "command", value: character });
      previousKind = "command";
      index += 1;
      continue;
    }

    NUMBER_AT_POSITION_PATTERN.lastIndex = index;
    const numberMatch = NUMBER_AT_POSITION_PATTERN.exec(value);
    if (numberMatch === null) {
      fail(`${label} contains invalid numeric syntax.`);
    }
    if (
      previousKind === "number" &&
      !hasSeparator &&
      (!allowCommands || !/^[+.-]$/u.test(character))
    ) {
      fail(`${label} must separate adjacent numeric values.`);
    }
    tokens.push({ kind: "number", value: numberMatch[0] });
    previousKind = "number";
    index = NUMBER_AT_POSITION_PATTERN.lastIndex;
  }
  return tokens;
}

function parseBoundedNumber(value, label, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || Math.abs(numericValue) > maximum) {
    fail(`${label} must contain bounded finite numeric values.`);
  }
  return numericValue;
}

function parseBoundedLength(value, label) {
  const match = value.trim().match(LENGTH_PATTERN);
  if (match === null) {
    fail(`${label} must use a finite unitless, px, or percentage length.`);
  }
  const maximum =
    match[2] === "%"
      ? MAX_PROVIDER_SVG_PERCENT_MAGNITUDE
      : MAX_PROVIDER_SVG_COORDINATE_MAGNITUDE;
  return {
    unit: match[2],
    value: parseBoundedNumber(match[1], label, maximum),
  };
}

function validateLengthList(attribute) {
  const value = attribute.value.trim();
  if (attribute.local === "stroke-dasharray" && value === "none") {
    return;
  }
  const parts = value.split(/(?:\s*,\s*|\s+)/u);
  if (parts.length === 0 || parts.some((part) => part === "")) {
    fail(`${attribute.local} must contain a separated length list.`);
  }
  for (const part of parts) {
    const length = parseBoundedLength(part, attribute.local);
    if (attribute.local === "stroke-dasharray" && length.value < 0) {
      fail("stroke-dasharray cannot contain negative lengths.");
    }
  }
}

function validatePathData(pathData) {
  if (pathData.trim() === "") {
    return { explicitCommandCount: 0, numericParameterCount: 0 };
  }
  const tokens = tokenizeNumberOrPathSequence(pathData, true, "path data");
  if (tokens[0]?.kind !== "command" || tokens[0].value.toUpperCase() !== "M") {
    fail("path data must begin with a move command.");
  }

  let explicitCommandCount = 0;
  let numericParameterCount = 0;
  let index = 0;
  while (index < tokens.length) {
    const commandToken = tokens[index];
    if (commandToken?.kind !== "command") {
      fail("path data must declare a command after a closed subpath.");
    }
    explicitCommandCount += 1;
    index += 1;

    const command = commandToken.value.toUpperCase();
    const parameterCount = PATH_PARAMETER_COUNTS[command];
    const parameterStart = index;
    while (tokens[index]?.kind === "number") {
      index += 1;
    }
    const suppliedParameterCount = index - parameterStart;
    if (parameterCount === 0) {
      if (suppliedParameterCount !== 0) {
        fail("close-path commands cannot consume numeric parameters.");
      }
      continue;
    }
    if (
      suppliedParameterCount === 0 ||
      suppliedParameterCount % parameterCount !== 0
    ) {
      fail(`path command ${command} has an invalid parameter count.`);
    }

    for (
      let parameterIndex = parameterStart;
      parameterIndex < index;
      parameterIndex += 1
    ) {
      const token = tokens[parameterIndex];
      const value = parseBoundedNumber(
        token.value,
        "path data",
        MAX_PROVIDER_SVG_COORDINATE_MAGNITUDE,
      );
      const position = (parameterIndex - parameterStart) % parameterCount;
      if (
        command === "A" &&
        (position === 3 || position === 4) &&
        token.value !== "0" &&
        token.value !== "1"
      ) {
        fail("arc flags must be exactly 0 or 1.");
      }
      if (command === "A" && (position === 0 || position === 1) && value < 0) {
        fail("arc radii cannot be negative.");
      }
    }
    numericParameterCount += suppliedParameterCount;
  }

  return { explicitCommandCount, numericParameterCount };
}

function validateGeometryAttribute(attribute) {
  if (attribute.local === "d") {
    return validatePathData(attribute.value);
  }
  if (attribute.local === "viewBox") {
    validateViewBoxValue(attribute.value);
    return undefined;
  }
  if (attribute.local === "points") {
    const tokens = tokenizeNumberOrPathSequence(
      attribute.value,
      false,
      "points",
    );
    if (tokens.length % 2 !== 0) {
      fail("points must contain coordinate pairs.");
    }
    for (const token of tokens) {
      parseBoundedNumber(
        token.value,
        "points",
        MAX_PROVIDER_SVG_COORDINATE_MAGNITUDE,
      );
    }
    return undefined;
  }
  if (LENGTH_LIST_ATTRIBUTES.has(attribute.local)) {
    validateLengthList(attribute);
    return undefined;
  }
  if (UNIT_INTERVAL_ATTRIBUTES.has(attribute.local)) {
    const value = parseBoundedNumber(attribute.value, attribute.local, 1);
    if (value < 0) {
      fail(`${attribute.local} cannot be negative.`);
    }
    return undefined;
  }
  if (!GEOMETRY_ATTRIBUTES.has(attribute.local)) {
    return undefined;
  }

  const length = parseBoundedLength(attribute.value, attribute.local);
  const value = length.value;
  if (NONNEGATIVE_GEOMETRY_ATTRIBUTES.has(attribute.local) && value < 0) {
    fail(`${attribute.local} cannot be negative.`);
  }
  if (
    attribute.local === "offset" &&
    (!["%", undefined].includes(length.unit) ||
      value < 0 ||
      value > (length.unit === "%" ? 100 : 1))
  ) {
    fail("offset must remain within its finite gradient interval.");
  }
  return undefined;
}

function validateViewBoxValue(viewBox) {
  const tokens = tokenizeNumberOrPathSequence(viewBox, false, "viewBox");
  const values = tokens.map((token) =>
    parseBoundedNumber(token.value, "viewBox", 1_000_000),
  );
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) {
    fail("the viewBox must contain four bounded finite values.");
  }

  return viewBox.trim().replaceAll(/\s+/gu, " ");
}

function validateViewBox(attributes) {
  const viewBox = readAttribute(attributes, "viewBox");
  if (viewBox === undefined) {
    fail("the root element must declare one finite viewBox.");
  }
  return validateViewBoxValue(viewBox);
}

function validateReferences(svg) {
  for (const match of svg.matchAll(
    /\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/giu,
  )) {
    const reference = match[2]?.trim() ?? "";
    if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(reference)) {
      fail("href references must target a local fragment.");
    }
  }

  for (const match of svg.matchAll(/\burl\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const reference = match[2]?.trim() ?? "";
    if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(reference)) {
      fail("CSS URL references must target a local fragment.");
    }
  }
}

function validateTransforms(svg) {
  for (const match of svg.matchAll(
    /\b(?:gradientTransform|transform)\s*=\s*(["'])(.*?)\1/giu,
  )) {
    const transform = match[2] ?? "";
    if (/(?:NaN|Infinity)/iu.test(transform)) {
      fail("transforms must contain finite values.");
    }
    const values = transform.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu);
    if (
      values?.some((value) => {
        const numericValue = Number(value);
        return !Number.isFinite(numericValue) || Math.abs(numericValue) > 1e7;
      }) === true
    ) {
      fail("transforms exceed the bounded numeric range.");
    }
  }
}

function validateDecodedAttribute(attribute) {
  const value = attribute.value;
  if (
    (attribute.name === "xmlns" || attribute.prefix === "xmlns") &&
    value === SAFE_XML_NAMESPACE
  ) {
    return;
  }
  if (URL_SCHEME_PATTERN.test(value)) {
    fail("decoded attributes cannot contain remote, data, blob, or file URLs.");
  }
  if (
    attribute.local === "href" &&
    !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(value)
  ) {
    fail("decoded href references must target a local fragment.");
  }
  for (const match of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const reference = match[2]?.trim() ?? "";
    if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(reference)) {
      fail("decoded CSS URL references must target a local fragment.");
    }
  }
}

function validateLocalReferenceGraph(ids, referencesById, referenceTargets) {
  for (const target of referenceTargets) {
    if (!ids.has(target)) {
      fail(`local fragment reference does not resolve: #${target}.`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      fail("local fragment references cannot be recursive.");
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const target of referencesById.get(id) ?? []) {
      visit(target);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) {
    visit(id);
  }
}

function validateWellFormedXml(svg) {
  let policyError;
  let elementCount = 0;
  let explicitPathCommandCount = 0;
  let numericPathParameterCount = 0;
  const ids = new Set();
  const referencesById = new Map();
  const activeIds = [];
  const referenceTargets = new Set();
  try {
    // Saxes is a streaming XML parser. It does not fetch external resources,
    // and the preflight below rejects declarations, DTDs, and entities before
    // parsing. Parsing is still required because regular expressions cannot
    // prove balanced elements or unique attributes.
    const parser = new SaxesParser({ fragment: false, xmlns: true });
    parser.on("opentag", (tag) => {
      try {
        elementCount += 1;
        if (elementCount > MAX_PROVIDER_SVG_ELEMENTS) {
          fail(
            `the file exceeds ${MAX_PROVIDER_SVG_ELEMENTS} rendered elements.`,
          );
        }
        const attributes = Object.values(tag.attributes);
        for (const attribute of attributes) {
          validateDecodedAttribute(attribute);
          const pathStats = validateGeometryAttribute(attribute);
          if (pathStats !== undefined) {
            explicitPathCommandCount += pathStats.explicitCommandCount;
            numericPathParameterCount += pathStats.numericParameterCount;
            if (
              Math.max(explicitPathCommandCount, numericPathParameterCount) >
              MAX_PROVIDER_SVG_PATH_COMMANDS
            ) {
              fail(
                `the file exceeds ${MAX_PROVIDER_SVG_PATH_COMMANDS} path commands.`,
              );
            }
          }
        }
        const id = attributes.find(
          (attribute) => attribute.name === "id",
        )?.value;
        if (id !== undefined) {
          if (ids.has(id)) {
            fail(`duplicate local fragment ID is forbidden: ${id}.`);
          }
          ids.add(id);
          referencesById.set(id, new Set());
        }
        activeIds.push(id);

        const localTargets = new Set();
        for (const attribute of attributes) {
          if (attribute.local === "href") {
            localTargets.add(attribute.value.slice(1));
          }
          for (const match of attribute.value.matchAll(
            /url\(\s*(["']?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/giu,
          )) {
            localTargets.add(match[2]);
          }
        }
        if (tag.local === "use") {
          const href = attributes.find(
            (attribute) => attribute.local === "href",
          )?.value;
          if (href === undefined) {
            fail("use elements require an explicit local fragment target.");
          }
        }
        for (const target of localTargets) {
          referenceTargets.add(target);
          for (const activeId of activeIds) {
            if (activeId !== undefined) {
              referencesById.get(activeId).add(target);
            }
          }
        }
      } catch (error) {
        policyError = error;
        throw error;
      }
    });
    parser.on("closetag", () => {
      activeIds.pop();
    });
    parser.write(svg).close();
  } catch {
    if (policyError !== undefined) {
      throw policyError;
    }
    fail("the file must be well-formed XML with unique attributes.");
  }
  validateLocalReferenceGraph(ids, referencesById, referenceTargets);
  return {
    elementCount,
    pathCommandCount: Math.max(
      explicitPathCommandCount,
      numericPathParameterCount,
    ),
  };
}

export function validateAndNormalizeSvg(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("Provider SVG input must be a Buffer.");
  }
  if (bytes.byteLength === 0) {
    fail("the file is empty.");
  }
  if (bytes.byteLength > MAX_PROVIDER_SVG_BYTES) {
    fail(`the file exceeds ${MAX_PROVIDER_SVG_BYTES} bytes.`);
  }

  let svg;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("the file is not valid UTF-8.");
  }

  if (svg.includes("\0")) {
    fail("NUL bytes are not allowed.");
  }

  svg = svg
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const withoutXmlDeclaration = stripInitialXmlDeclaration(svg);

  if (/<!DOCTYPE|<!ENTITY|<\?|<xi:include\b/iu.test(withoutXmlDeclaration)) {
    fail(
      "DTD, entity, processing-instruction, and inclusion constructs are forbidden.",
    );
  }
  if (
    /&(?:#(?:x[0-9a-f]+|\d+)|[A-Za-z][A-Za-z0-9]+);/iu.test(
      withoutXmlDeclaration,
    )
  ) {
    fail("character and entity references are forbidden.");
  }
  if (withoutXmlDeclaration.includes("\\")) {
    fail("backslash escapes are forbidden.");
  }
  if (
    NAMESPACE_PREFIXED_ELEMENT_PATTERN.test(withoutXmlDeclaration) ||
    NAMESPACE_PREFIXED_ATTRIBUTE_PATTERN.test(withoutXmlDeclaration)
  ) {
    fail("namespace-prefixed elements and attributes are forbidden.");
  }
  if (FORBIDDEN_ELEMENT_PATTERN.test(withoutXmlDeclaration)) {
    fail(
      "an executable, embedded, or unbounded-complexity element is present.",
    );
  }
  if (EVENT_HANDLER_PATTERN.test(withoutXmlDeclaration)) {
    fail("event-handler attributes are forbidden.");
  }
  if (STYLE_ATTRIBUTE_PATTERN.test(withoutXmlDeclaration)) {
    fail("inline style attributes are forbidden.");
  }
  if (/@import|@font-face|expression\s*\(/iu.test(withoutXmlDeclaration)) {
    fail("external or executable CSS is forbidden.");
  }

  const xmlStats = validateWellFormedXml(withoutXmlDeclaration);

  const rootElements = [...withoutXmlDeclaration.matchAll(/<svg\b([^>]*)>/giu)];
  if (rootElements.length !== 1) {
    fail("exactly one root svg element is required.");
  }
  if (!/<\/svg>\s*$/iu.test(withoutXmlDeclaration)) {
    fail("the root svg element must be closed.");
  }

  const rootAttributes = rootElements[0]?.[1] ?? "";
  const namespace = readAttribute(rootAttributes, "xmlns");
  if (namespace !== undefined && namespace !== SAFE_XML_NAMESPACE) {
    fail("the SVG namespace is not recognized.");
  }

  const remoteScan = withoutXmlDeclaration.replaceAll(SAFE_XML_NAMESPACE, "");
  if (URL_SCHEME_PATTERN.test(remoteScan)) {
    fail("remote, data, blob, and file URLs are forbidden.");
  }

  validateReferences(withoutXmlDeclaration);
  validateTransforms(withoutXmlDeclaration);
  const viewBox = validateViewBox(rootAttributes);

  const normalized = `${withoutXmlDeclaration
    .replaceAll(/<!--[\s\S]*?-->/gu, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()}\n`;
  const normalizedBytes = Buffer.from(normalized, "utf8");
  if (normalizedBytes.byteLength > MAX_PROVIDER_SVG_BYTES) {
    fail(`the normalized file exceeds ${MAX_PROVIDER_SVG_BYTES} bytes.`);
  }

  return Object.freeze({
    bytes: normalizedBytes,
    elementCount: xmlStats.elementCount,
    pathCommandCount: xmlStats.pathCommandCount,
    viewBox,
  });
}
