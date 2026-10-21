import { TextDecoder } from "node:util";

import { SaxesParser } from "saxes";

import {
  MAX_PROVIDER_SVG_BYTES,
  MAX_PROVIDER_SVG_ELEMENTS,
} from "./svg-policy.mjs";
import { REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP } from "./transformation-steps.mjs";
import { stripInitialXmlDeclaration } from "./xml-source.mjs";

export { REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const EXACT_ROOT_XLINK_DECLARATION =
  ' xmlns:xlink="http://www.w3.org/1999/xlink"';
const XML_WHITESPACE_PATTERN = /[\t\n\r ]/u;
const ENTITY_REFERENCE_PATTERN =
  /&(?:#(?:x[0-9a-f]+|\d+)|[A-Za-z][A-Za-z0-9]+);/iu;
const DECEPTIVE_XLINK_TOKEN_PATTERN =
  /(?:xmlns\s*:\s*xlink|xlink\s*:|http:\/\/www\.w3\.org\/1999\/xlink)/iu;

function unchanged(bytes) {
  return Object.freeze({
    bytes: Buffer.from(bytes),
    removedUnusedRootXlinkNamespaceDeclaration: false,
  });
}

function passesSourcePreflight(bytes, source) {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_PROVIDER_SVG_BYTES ||
    source.includes("\0") ||
    source.includes("\\")
  ) {
    return false;
  }

  const withoutBom = source.replace(/^\uFEFF/u, "");
  const withoutXmlDeclaration = stripInitialXmlDeclaration(withoutBom);
  return (
    !/<!DOCTYPE|<!ENTITY|<\?|<xi:include\b/iu.test(withoutXmlDeclaration) &&
    !ENTITY_REFERENCE_PATTERN.test(withoutXmlDeclaration)
  );
}

function exactRootDeclarationSpan(source, rootStart, rootEnd) {
  let cursor = rootStart + "<svg".length;
  let declarationSpan;

  while (cursor < rootEnd) {
    const separatorStart = cursor;
    while (XML_WHITESPACE_PATTERN.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    if (source[cursor] === ">" || source[cursor] === "/") {
      break;
    }

    const nameStart = cursor;
    while (!/[\t\n\r =/>]/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    const name = source.slice(nameStart, cursor);
    while (XML_WHITESPACE_PATTERN.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    if (name === "" || source[cursor] !== "=") {
      return undefined;
    }
    cursor += 1;
    while (XML_WHITESPACE_PATTERN.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      return undefined;
    }
    cursor += 1;
    const valueEnd = source.indexOf(quote, cursor);
    if (valueEnd === -1 || valueEnd >= rootEnd) {
      return undefined;
    }
    cursor = valueEnd + 1;

    if (name === "xmlns:xlink") {
      if (
        declarationSpan !== undefined ||
        source.slice(separatorStart, cursor) !== EXACT_ROOT_XLINK_DECLARATION
      ) {
        return undefined;
      }
      declarationSpan = Object.freeze({ end: cursor, start: separatorStart });
    }
  }

  return declarationSpan;
}

function proveUnusedExactRootXlinkDeclaration(source) {
  let declarationCount = 0;
  let elementCount = 0;
  let rootDefaultNamespaceCount = 0;
  let rootEnd;
  let rootStart;
  let unsupported = false;

  try {
    const parser = new SaxesParser({ fragment: false, xmlns: true });
    parser.on("opentagstart", (tag) => {
      if (rootStart === undefined) {
        rootStart = parser.position - tag.name.length - 2;
      }
    });
    parser.on("opentag", (tag) => {
      elementCount += 1;
      if (elementCount > MAX_PROVIDER_SVG_ELEMENTS) {
        throw new TypeError("Provider SVG source exceeds the element limit.");
      }

      const isRoot = elementCount === 1;
      if (isRoot) {
        rootEnd = parser.position;
      }
      if (
        tag.prefix !== "" ||
        tag.local !== (isRoot ? "svg" : tag.name) ||
        tag.uri !== SVG_NAMESPACE
      ) {
        unsupported = true;
      }

      for (const attribute of Object.values(tag.attributes)) {
        if (attribute.name === "xmlns") {
          if (!isRoot || attribute.value !== SVG_NAMESPACE) {
            unsupported = true;
          } else {
            rootDefaultNamespaceCount += 1;
          }
        } else if (attribute.prefix === "xmlns") {
          if (
            !isRoot ||
            attribute.local !== "xlink" ||
            attribute.value !== XLINK_NAMESPACE
          ) {
            unsupported = true;
          } else {
            declarationCount += 1;
          }
        } else if (attribute.prefix !== "") {
          unsupported = true;
        }
      }
    });
    parser.write(source).close();
  } catch {
    return undefined;
  }

  if (
    unsupported ||
    elementCount === 0 ||
    declarationCount !== 1 ||
    rootDefaultNamespaceCount !== 1 ||
    rootStart === undefined ||
    rootEnd === undefined ||
    source.slice(rootStart, rootStart + 4) !== "<svg"
  ) {
    return undefined;
  }

  return exactRootDeclarationSpan(source, rootStart, rootEnd);
}

export function normalizeImportedProviderSvgSource(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("Provider SVG source input must be a Buffer.");
  }

  let source;
  try {
    source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return unchanged(bytes);
  }
  if (!passesSourcePreflight(bytes, source)) {
    return unchanged(bytes);
  }

  const declarationSpan = proveUnusedExactRootXlinkDeclaration(source);
  if (declarationSpan === undefined) {
    return unchanged(bytes);
  }

  const transformedSource = `${source.slice(
    0,
    declarationSpan.start,
  )}${source.slice(declarationSpan.end)}`;
  if (DECEPTIVE_XLINK_TOKEN_PATTERN.test(transformedSource)) {
    return unchanged(bytes);
  }

  const byteStart = Buffer.byteLength(
    source.slice(0, declarationSpan.start),
    "utf8",
  );
  const byteEnd = byteStart + Buffer.byteLength(EXACT_ROOT_XLINK_DECLARATION);
  const transformedBytes = Buffer.concat([
    bytes.subarray(0, byteStart),
    bytes.subarray(byteEnd),
  ]);

  return Object.freeze({
    bytes: transformedBytes,
    removedUnusedRootXlinkNamespaceDeclaration: true,
  });
}
