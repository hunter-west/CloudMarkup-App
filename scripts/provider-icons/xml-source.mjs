const XML_WHITESPACE = String.raw`[\t\n\r ]`;
const QUOTED_XML_VERSION = String.raw`(?:"1\.[01]"|'1\.[01]')`;
const QUOTED_UTF8_ENCODING = String.raw`(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8')`;
const QUOTED_STANDALONE = String.raw`(?:"(?:yes|no)"|'(?:yes|no)')`;

const INITIAL_XML_DECLARATION_PATTERN = new RegExp(
  String.raw`^${XML_WHITESPACE}*<\?xml${XML_WHITESPACE}+version${XML_WHITESPACE}*=${XML_WHITESPACE}*${QUOTED_XML_VERSION}(?:${XML_WHITESPACE}+encoding${XML_WHITESPACE}*=${XML_WHITESPACE}*${QUOTED_UTF8_ENCODING})?(?:${XML_WHITESPACE}+standalone${XML_WHITESPACE}*=${XML_WHITESPACE}*${QUOTED_STANDALONE})?${XML_WHITESPACE}*\?>${XML_WHITESPACE}*`,
  "u",
);

export function stripInitialXmlDeclaration(source) {
  if (typeof source !== "string") {
    throw new TypeError("XML source must be a string.");
  }
  return source.replace(INITIAL_XML_DECLARATION_PATTERN, "");
}
