export const LOCAL_CORS_EXPOSED_HEADERS_V1 = [
  "Content-Disposition",
  "Content-Security-Policy",
  "ETag",
  "Referrer-Policy",
  "X-CloudMarkup-Content-Sha256",
  "X-Content-Type-Options",
  "X-Correlation-Id",
] as const;

export const LOCAL_CORS_EXPOSED_HEADERS_VALUE_V1 =
  LOCAL_CORS_EXPOSED_HEADERS_V1.join(", ");
