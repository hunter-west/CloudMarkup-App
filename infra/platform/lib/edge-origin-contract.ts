export const EDGE_ORIGIN_HEADER_NAME = "x-cloudmarkup-edge-origin" as const;
export const EDGE_ORIGIN_VERIFICATION_ENVIRONMENT_VARIABLE =
  "CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION" as const;
export const EDGE_ORIGIN_VERIFICATION_ALLOWED_PATTERN =
  "^[A-Za-z0-9._~-]{32,128}$" as const;

/**
 * Bind the deployment-time CloudFormation value to a Lambda without exposing
 * the value in source or synthesized output. This prevents casual direct-origin
 * use but does not replace identity, tenant authorization, provider signatures,
 * or WAF.
 */
export function edgeOriginEnvironment(
  verificationValue: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    [EDGE_ORIGIN_VERIFICATION_ENVIRONMENT_VARIABLE]: verificationValue,
  });
}
