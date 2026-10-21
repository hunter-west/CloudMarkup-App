/** Reviewed explicit actions for the initial key-policy variant. Never accept wildcard input. */
export const kmsKeyAdminActions = new Set([
  "kms:DescribeKey",
  "kms:GetKeyPolicy",
  "kms:PutKeyPolicy",
  "kms:UpdateKeyDescription",
  "kms:EnableKey",
  "kms:DisableKey",
  "kms:GetKeyRotationStatus",
  "kms:EnableKeyRotation",
  "kms:DisableKeyRotation",
  "kms:ListResourceTags",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:ScheduleKeyDeletion",
  "kms:CancelKeyDeletion",
]);
export const kmsKeyUserActions = new Set([
  "kms:DescribeKey",
  "kms:Encrypt",
  "kms:Decrypt",
  "kms:ReEncryptFrom",
  "kms:ReEncryptTo",
  "kms:GenerateDataKey",
  "kms:GenerateDataKeyWithoutPlaintext",
]);
export function kmsRoleAccount(principal: string): string | undefined {
  const match =
    /^arn:(aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role\/(?:[A-Za-z0-9+=,.@_-]+\/)*[A-Za-z0-9+=,.@_-]{1,64}$/u.exec(
      principal,
    );
  const partition = match?.[1];
  const account = match?.[2];
  return partition && account ? `${partition}:${account}` : undefined;
}
