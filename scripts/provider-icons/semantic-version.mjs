const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;

function parseSemanticVersion(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.match(SEMANTIC_VERSION_PATTERN);
  if (match === null) {
    return undefined;
  }

  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  if (
    prerelease.some(
      (identifier) =>
        NUMERIC_IDENTIFIER_PATTERN.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    return undefined;
  }

  return Object.freeze({
    core: Object.freeze([match[1], match[2], match[3]]),
    prerelease: Object.freeze(prerelease),
  });
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isSemanticVersion(value) {
  return parseSemanticVersion(value) !== undefined;
}

export function compareSemanticVersions(left, right) {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw new TypeError("Semantic version comparison requires valid versions.");
  }

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference = compareNumericIdentifiers(
      leftVersion.core[index],
      rightVersion.core[index],
    );
    if (difference !== 0) {
      return difference;
    }
  }

  if (
    leftVersion.prerelease.length === 0 ||
    rightVersion.prerelease.length === 0
  ) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) {
      return 0;
    }
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }

  for (
    let index = 0;
    index <
    Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
    index += 1
  ) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier
        ? 0
        : leftIdentifier === undefined
          ? -1
          : 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftIdentifier);
    const rightIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightIdentifier);
    if (leftIsNumeric && rightIsNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  return 0;
}
