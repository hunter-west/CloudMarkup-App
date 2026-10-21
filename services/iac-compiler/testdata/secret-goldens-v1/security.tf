resource "aws_secretsmanager_secret" "application_secret" {
  name                    = "application/credential"
  description             = "Externally populated synthetic credential"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.application_key.arn
  tags                    = local.tags
  lifecycle {
    prevent_destroy = true
  }
}

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

data "aws_iam_policy_document" "reader_trust" {
  statement {
    sid     = "readertrust"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "secret_access" {
  statement {
    sid       = "secretaccess"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application_secret.arn]
  }
}

resource "aws_iam_role_policy" "secret_access" {
  name   = "secret_access"
  role   = aws_iam_role.secret_reader.name
  policy = data.aws_iam_policy_document.secret_access.json
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
