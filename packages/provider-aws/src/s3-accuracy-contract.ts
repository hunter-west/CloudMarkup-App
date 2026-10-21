/** The curated resource creates general-purpose buckets in the shared namespace. */
export const s3SharedBucketNamePattern =
  "^(?!xn--)(?!sthree-)(?!amzn-s3-demo-)(?!.*\\.\\.)(?![0-9]{1,3}(?:\\.[0-9]{1,3}){3}$)(?!.*(?:-s3alias|--ol-s3|\\.mrap|--x-s3|--table-s3|-an)$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](?![\\s\\S])";
const sharedName = new RegExp(s3SharedBucketNamePattern, "u");
export function isS3SharedBucketName(value: string): boolean {
  return sharedName.test(value);
}

/** Decode one transport layer for comparison only; never rewrite graph values. */
export function s3NotificationFilterKey(value: string): string | undefined {
  if (value.length > 1024) return undefined;
  for (const character of value) {
    if (
      character.charCodeAt(0) < 33 ||
      character.charCodeAt(0) > 126 ||
      character === "*"
    )
      return undefined;
  }
  try {
    const decoded = decodeURIComponent(value.replaceAll("+", " "));
    return decoded.includes("*") ? undefined : decoded;
  } catch {
    return undefined;
  }
}

export function s3NotificationFiltersOverlap(
  left: { prefix: string; suffix: string },
  right: { prefix: string; suffix: string },
): boolean {
  return (
    (left.prefix.startsWith(right.prefix) ||
      right.prefix.startsWith(left.prefix)) &&
    (left.suffix.endsWith(right.suffix) || right.suffix.endsWith(left.suffix))
  );
}
