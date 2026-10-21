data "aws_iam_policy_document" "key_policy" {
  statement {
    sid       = "KeyAdmin"
    effect    = "Allow"
    actions   = ["kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::000000000000:role/synthetic-key-admin"]
    }
  }
}

resource "aws_kms_key" "application_key" {
  description                        = "Synthetic application encryption"
  customer_master_key_spec           = "SYMMETRIC_DEFAULT"
  key_usage                          = "ENCRYPT_DECRYPT"
  multi_region                       = false
  is_enabled                         = true
  enable_key_rotation                = true
  rotation_period_in_days            = 365
  deletion_window_in_days            = 30
  bypass_policy_lockout_safety_check = false
  policy                             = data.aws_iam_policy_document.key_policy.json
  tags                               = local.tags
  lifecycle {
    prevent_destroy = true
  }
}
