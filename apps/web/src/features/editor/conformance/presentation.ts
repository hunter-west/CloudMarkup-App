const sensitiveLabelPattern =
  /(?:\b(?:access[_-]?key|api[_-]?key|authorization|bearer|client[_-]?secret|credential|password|private[_-]?key|secret|session[_-]?token|token)\b|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|https?:\/\/|file:\/\/|[A-Za-z]:\\|\/(?:home|tmp|Users|var)\/)/iu;

export function safeConformanceLabel(
  value: string,
  maximumLength = 160,
): string {
  let withoutControls = "";
  for (const character of value.normalize("NFC")) {
    const codePoint = character.codePointAt(0) ?? 0;
    withoutControls +=
      codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }
  const normalized = withoutControls.replace(/\s+/gu, " ").trim();
  if (normalized === "") return "Unnamed";
  if (sensitiveLabelPattern.test(normalized)) {
    return "Sensitive label redacted";
  }
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}

export function compareConformanceText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
