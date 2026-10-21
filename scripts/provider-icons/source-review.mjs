const SOURCE_FIELDS = Object.freeze([
  "packageLabel",
  "packageVersion",
  "origin",
  "packageSha256",
  "importedAt",
]);

const APPROVAL_FIELDS = Object.freeze([
  "recordId",
  "reviewerName",
  "reviewerRole",
  "reviewerRelationship",
  "approvalDate",
  "approvedSurfaces",
  "trademarkUseAcknowledgment",
  "accessibilityContract",
]);

const HEADER = Object.freeze([
  "# Cloud Markup provider-icon source and product-owner approval",
  "",
  "This file is the authoritative owner evidence for the checked provider-icon manifest.",
  "",
  "## Official source",
  "",
]);

const APPROVAL_HEADER = Object.freeze(["", "## Product-owner approval", ""]);

function fail(message) {
  throw new TypeError(`Invalid provider icon source review: ${message}`);
}

function assertExactObject(value, fields, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertFieldValue(field, value) {
  if (field === "approvedSurfaces") {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some(
        (surface) =>
          typeof surface !== "string" ||
          surface.trim() === "" ||
          hasControlCharacters(surface),
      )
    ) {
      fail("approvedSurfaces must be a non-empty array of text values.");
    }
    return;
  }
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    hasControlCharacters(value)
  ) {
    fail(`${field} must be non-empty text without control characters.`);
  }
}

function copyFields(value, fields, label) {
  assertExactObject(value, fields, label);
  return Object.fromEntries(
    fields.map((field) => {
      assertFieldValue(field, value[field]);
      return [
        field,
        Array.isArray(value[field]) ? [...value[field]] : value[field],
      ];
    }),
  );
}

function ownerEvidenceFrom(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("record must be an object.");
  }
  const source = copyFields(value.source, SOURCE_FIELDS, "source");
  const approval = copyFields(value.approval, APPROVAL_FIELDS, "approval");
  return Object.freeze({
    approval: Object.freeze({
      ...approval,
      approvedSurfaces: Object.freeze([...approval.approvedSurfaces]),
    }),
    source: Object.freeze(source),
  });
}

function fieldLine(field, value) {
  return `- ${field}: ${JSON.stringify(value)}`;
}

function renderOwnerEvidence(record) {
  return [
    ...HEADER,
    ...SOURCE_FIELDS.map((field) => fieldLine(field, record.source[field])),
    ...APPROVAL_HEADER,
    ...APPROVAL_FIELDS.map((field) => fieldLine(field, record.approval[field])),
    "",
  ].join("\n");
}

export function generateProviderIconSourceReview(manifest) {
  return renderOwnerEvidence(
    ownerEvidenceFrom({
      approval: manifest?.approval,
      source: manifest?.source,
    }),
  );
}

function parseFieldLine(line, field) {
  const prefix = `- ${field}: `;
  if (!line.startsWith(prefix)) {
    fail(`expected field ${field}.`);
  }
  let value;
  try {
    value = JSON.parse(line.slice(prefix.length));
  } catch {
    fail(`field ${field} must use canonical JSON syntax.`);
  }
  assertFieldValue(field, value);
  if (line !== fieldLine(field, value)) {
    fail(`field ${field} is not canonically encoded.`);
  }
  return value;
}

export function parseProviderIconSourceReview(text) {
  if (typeof text !== "string" || text.includes("\0")) {
    fail("record must be UTF-8 text without NUL bytes.");
  }
  const lines = text.split("\n");
  const expectedLineCount =
    HEADER.length +
    SOURCE_FIELDS.length +
    APPROVAL_HEADER.length +
    APPROVAL_FIELDS.length +
    1;
  if (lines.length !== expectedLineCount) {
    fail("record has unexpected or missing content.");
  }

  let index = 0;
  for (const expected of HEADER) {
    if (lines[index] !== expected) {
      fail("record header is invalid.");
    }
    index += 1;
  }
  const source = Object.fromEntries(
    SOURCE_FIELDS.map((field) => [
      field,
      parseFieldLine(lines[index++], field),
    ]),
  );
  for (const expected of APPROVAL_HEADER) {
    if (lines[index] !== expected) {
      fail("product-owner approval heading is invalid.");
    }
    index += 1;
  }
  const approval = Object.fromEntries(
    APPROVAL_FIELDS.map((field) => [
      field,
      parseFieldLine(lines[index++], field),
    ]),
  );
  if (lines[index] !== "") {
    fail("record must end with one newline.");
  }

  const record = ownerEvidenceFrom({ approval, source });
  if (renderOwnerEvidence(record) !== text) {
    fail("record is not in deterministic canonical form.");
  }
  return record;
}

export function validateProviderIconSourceReview(text, manifest) {
  const actual = parseProviderIconSourceReview(text);
  const expected = ownerEvidenceFrom({
    approval: manifest?.approval,
    source: manifest?.source,
  });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      "record does not exactly match manifest source and approval evidence.",
    );
  }
  return actual;
}
