data "aws_iam_policy_document" "bucket_access" {
  statement {
    sid       = "bucketaccess"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.uploads.arn]
  }
}

data "aws_iam_policy_document" "mixed_access" {
  statement {
    sid       = "mixedaccess"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:ListBucket", "s3:PutObject"]
    resources = [aws_s3_bucket.uploads.arn, format("%s/*", aws_s3_bucket.uploads.arn)]
  }
}

data "aws_iam_policy_document" "object_access" {
  statement {
    sid       = "objectaccess"
    effect    = "Allow"
    actions   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
    resources = [format("%s/*", aws_s3_bucket.uploads.arn)]
  }
}

data "aws_iam_policy_document" "object_deny" {
  statement {
    sid       = "objectdeny"
    effect    = "Deny"
    actions   = ["s3:DeleteObject"]
    resources = [format("%s/*", aws_s3_bucket.uploads.arn)]
  }
}

data "aws_iam_policy_document" "trust_policy" {
  statement {
    sid     = "trustpolicy"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "bucket_access" {
  name   = "bucket_access"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.bucket_access.json
}

resource "aws_iam_role_policy" "mixed_access" {
  name   = "mixed_access"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.mixed_access.json
}

resource "aws_iam_role_policy" "object_access" {
  name   = "object_access"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.object_access.json
}

resource "aws_iam_role_policy" "object_deny" {
  name   = "object_deny"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.object_deny.json
}

data "aws_caller_identity" "s3_permission" {
}

resource "aws_lambda_permission" "s3_permission" {
  statement_id   = "s3permission"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.notes_handler.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.uploads.arn
  source_account = data.aws_caller_identity.s3_permission.account_id
}
