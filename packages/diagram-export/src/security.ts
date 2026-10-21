import { createHash } from "node:crypto";

import type { DiagramSha256Digest } from "./contracts.js";

const FORBIDDEN_TEXT_PATTERN =
  /(?:\b(?:access[_-]?key|api[_-]?key|authorization|bearer|client[_-]?secret|credential|password|private[_-]?key|secret|session[_-]?token|token)\b|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|https?:\/\/|file:\/\/|[A-Za-z]:\\|\/(?:home|tmp|Users|var)\/)/iu;

const ALLOWED_ICON_ELEMENTS = new Set(["g", "path", "rect", "svg", "title"]);
const ALLOWED_ICON_ATTRIBUTES = new Set([
  "clip-rule",
  "d",
  "fill",
  "fill-rule",
  "height",
  "stroke",
  "stroke-width",
  "version",
  "viewBox",
  "width",
  "x",
  "xmlns",
  "y",
]);

export function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function digestBytes(value: string | Uint8Array): DiagramSha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as DiagramSha256Digest;
}

export function utf8Size(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export class DiagramSecurityError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DiagramSecurityError";
  }
}

function replaceControlCharacters(input: string): string {
  let output = "";
  for (const character of input) {
    const code = character.charCodeAt(0);
    output += code <= 31 || code === 127 ? " " : character;
  }
  return output;
}

export function sanitizeDiagramText(
  input: string,
  maximumLength: number,
): { readonly truncated: boolean; readonly value: string } {
  const value = replaceControlCharacters(input.normalize("NFC"))
    .replace(/\s+/gu, " ")
    .trim();
  if (value.length === 0) {
    return { truncated: false, value: "Unnamed" };
  }
  if (FORBIDDEN_TEXT_PATTERN.test(value)) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.sensitive-label",
      "Diagram labels must not contain secrets, URLs, or local paths.",
    );
  }
  if (value.length <= maximumLength) {
    return { truncated: false, value };
  }
  return {
    truncated: true,
    value: `${value.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`,
  };
}

interface ParsedTag {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
  readonly attributes: readonly [string, string][];
}

function parseAttributes(raw: string): readonly [string, string][] {
  const attributes: [string, string][] = [];
  const attributePattern = /([A-Za-z][A-Za-z-]*)\s*=\s*(["'])(.*?)\2/gu;
  let match: RegExpExecArray | null;
  let consumed = raw.replace(/^\s+/u, "");
  while ((match = attributePattern.exec(raw)) !== null) {
    const [whole, name, , value] = match;
    if (name === undefined || value === undefined) {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-invalid",
        "Provider icon attributes could not be parsed safely.",
      );
    }
    attributes.push([name, value]);
    consumed = consumed.replace(whole, "");
  }
  if (consumed.replace(/\s+/gu, "") !== "") {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-invalid",
      "Provider icon contains unsupported attribute syntax.",
    );
  }
  return attributes;
}

function parseTag(rawTag: string): ParsedTag {
  const closing = rawTag.startsWith("</");
  const selfClosing = rawTag.endsWith("/>");
  const content = rawTag.slice(closing ? 2 : 1, selfClosing ? -2 : -1).trim();
  const nameMatch = /^([A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/u.exec(content);
  if (nameMatch === null) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-invalid",
      "Provider icon contains malformed markup.",
    );
  }
  const name = nameMatch[1];
  const rawAttributes = nameMatch[2] ?? "";
  if (name === undefined || !ALLOWED_ICON_ELEMENTS.has(name)) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-element-forbidden",
      "Provider icon contains an unsupported SVG element.",
    );
  }
  return {
    attributes: closing ? [] : parseAttributes(rawAttributes),
    closing,
    name,
    selfClosing,
  };
}

function canonicalAttributes(
  attributes: readonly [string, string][],
  root: boolean,
): string {
  const seen = new Set<string>();
  const retained = attributes.flatMap(([name, value]) => {
    if (!ALLOWED_ICON_ATTRIBUTES.has(name)) {
      if (name === "id") {
        return [];
      }
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-attribute-forbidden",
        "Provider icon contains an unsupported SVG attribute.",
      );
    }
    if (seen.has(name)) {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-invalid",
        "Provider icon attributes must be unique.",
      );
    }
    seen.add(name);
    const approvedNamespace =
      name === "xmlns" && value === "http://www.w3.org/2000/svg";
    if (
      !approvedNamespace &&
      /url\s*\(|https?:|data:|file:|javascript:/iu.test(value)
    ) {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-url-forbidden",
        "Provider icons cannot contain URLs or executable references.",
      );
    }
    if (
      root &&
      !["height", "viewBox", "width", "xmlns", "version", "fill"].includes(name)
    ) {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-root-invalid",
        "Provider icon root attributes are not approved.",
      );
    }
    return [[name, value] as const];
  });
  return retained
    .sort(([left], [right]) => compareUtf16(left, right))
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
}

/**
 * Re-parses the narrow reviewed provider-icon subset and emits a canonical
 * fragment. IDs and title elements are removed so embedded assets cannot
 * collide with document IDs or duplicate the visible service name.
 */
export function sanitizeProviderIconSvg(
  svg: string,
  expectedViewBox: string,
): string {
  if (
    /<!|<\?|&[A-Za-z#]|<foreignObject|<script|<style|\bon[A-Za-z]+\s*=|\bhref\s*=|\bxlink:/iu.test(
      svg,
    )
  ) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-active-content",
      "Provider icon contains active, external, or unsupported XML content.",
    );
  }

  const tokens = svg.match(/<[^>]+>|[^<]+/gu);
  if (tokens === null) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-invalid",
      "Provider icon contains no SVG markup.",
    );
  }
  const output: string[] = [];
  const stack: string[] = [];
  let rootSeen = false;
  let ignoringTitle = false;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (!ignoringTitle && token.trim().length > 0) {
        throw new DiagramSecurityError(
          "cloudmarkup.diagram.icon-text-forbidden",
          "Provider icons cannot contain visible text nodes.",
        );
      }
      continue;
    }
    const tag = parseTag(token);
    if (tag.closing) {
      const opened = stack.pop();
      if (opened !== tag.name) {
        throw new DiagramSecurityError(
          "cloudmarkup.diagram.icon-invalid",
          "Provider icon element nesting is invalid.",
        );
      }
      if (tag.name === "title") {
        ignoringTitle = false;
        continue;
      }
      output.push(`</${tag.name}>`);
      continue;
    }
    const isRoot = !rootSeen;
    if (isRoot && tag.name !== "svg") {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-root-invalid",
        "Provider icon root must be an SVG element.",
      );
    }
    if (!isRoot && tag.name === "svg") {
      throw new DiagramSecurityError(
        "cloudmarkup.diagram.icon-nested-svg",
        "Provider icons cannot contain nested SVG documents.",
      );
    }
    rootSeen = true;
    if (tag.name === "title") {
      if (tag.selfClosing) {
        continue;
      }
      ignoringTitle = true;
      stack.push(tag.name);
      continue;
    }
    const attributes = canonicalAttributes(tag.attributes, isRoot);
    if (isRoot) {
      const viewBox = tag.attributes.find(([name]) => name === "viewBox")?.[1];
      if (viewBox !== expectedViewBox) {
        throw new DiagramSecurityError(
          "cloudmarkup.diagram.icon-viewbox-mismatch",
          "Provider icon viewBox does not match its approved manifest.",
        );
      }
    }
    output.push(`<${tag.name}${attributes}${tag.selfClosing ? "/>" : ">"}`);
    if (!tag.selfClosing) {
      stack.push(tag.name);
    }
  }
  if (!rootSeen || stack.length > 0 || ignoringTitle) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-invalid",
      "Provider icon XML is incomplete.",
    );
  }
  return `${output.join("")}\n`;
}

export function iconInnerMarkup(svg: string): string {
  const match = /^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/u.exec(svg);
  if (match?.[1] === undefined) {
    throw new DiagramSecurityError(
      "cloudmarkup.diagram.icon-invalid",
      "Sanitized provider icon is not a complete SVG document.",
    );
  }
  return match[1];
}
